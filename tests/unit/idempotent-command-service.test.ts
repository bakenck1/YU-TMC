import { describe, expect, it, vi } from "vitest";

import type {
  IdempotencyRequestRepository,
} from "@/lib/application/ports/inventory-concurrency-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { executeIdempotentCommand } from "@/lib/application/services/idempotent-command-service";

const now = new Date("2026-07-28T12:00:00.000Z");
const input = {
  actorId: "00000000-0000-4000-8000-000000000001",
  operation: "item.update",
  key: "mobile-request-1",
  requestHash: "a".repeat(64),
  expiresAt: new Date("2026-07-29T12:00:00.000Z"),
  id: "00000000-0000-4000-8000-000000000002",
};

function repository(
  reservation: Awaited<ReturnType<IdempotencyRequestRepository["reserve"]>>,
): IdempotencyRequestRepository {
  return {
    reserve: vi.fn().mockResolvedValue(reservation),
    complete: vi.fn().mockResolvedValue(undefined),
  };
}

function unitOfWork(
  idempotency: IdempotencyRequestRepository,
): UnitOfWork<{ idempotency: IdempotencyRequestRepository }> {
  return {
    read: async (work) => work({ idempotency }),
    transaction: async (work) => work({ idempotency }),
  };
}

describe("executeIdempotentCommand", () => {
  it("completes a reserved request once and stores its safe response", async () => {
    const store = repository({ kind: "reserved", id: input.id });
    const response = {
      status: 201,
      body: { id: "item-1" },
      resourceId: "item-1",
    };
    const work = vi.fn().mockResolvedValue(response);

    await expect(executeIdempotentCommand(unitOfWork(store), input, now, work)).resolves.toEqual({
      kind: "completed",
      response,
    });
    expect(store.complete).toHaveBeenCalledWith(input.id, response, now);
  });

  it("replays a completed response without invoking the mutation", async () => {
    const response = { status: 200, body: { id: "item-1" } };
    const store = repository({ kind: "replay", response });
    const work = vi.fn();

    await expect(executeIdempotentCommand(unitOfWork(store), input, now, work)).resolves.toEqual({
      kind: "replayed",
      response,
    });
    expect(work).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["key_reused", "idempotency_key_reused"],
    ["in_progress", "idempotency_request_in_progress"],
  ] as const)("rejects %s reservations", async (kind, publicCode) => {
    const store = repository({ kind });

    await expect(
      executeIdempotentCommand(unitOfWork(store), input, now, vi.fn()),
    ).rejects.toMatchObject({ publicCode });
  });

  it("does not complete a reservation when the transactional mutation fails", async () => {
    const store = repository({ kind: "reserved", id: input.id });
    const failure = new Error("mutation failed");

    await expect(
      executeIdempotentCommand(unitOfWork(store), input, now, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(store.complete).not.toHaveBeenCalled();
  });
});
