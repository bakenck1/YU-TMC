import { describe, expect, it } from "vitest";

import type {
  AppendResponsibilityAuditRecord,
  CloseResponsibilityRecord,
  DecideTransferRecord,
  CancelTransferRecord,
  InsertResponsibilityRecord,
  InsertTransferRecord,
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  ItemResponsibilityState,
  OverrideTransferRecord,
  ResponsibilityTimelineRecord,
  TransferRecord,
} from "@/lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "@/lib/application/services/inventory-responsibility-service";

const NOW = new Date("2026-07-29T08:00:00.000Z");
const EMPLOYEE = { userId: "employee-1", role: "employee" as const };
const OWNER = { userId: "owner-1", role: "employee" as const };
const UNRELATED_EMPLOYEE = { userId: "employee-2", role: "employee" as const };
const TECHNICIAN = { userId: "tech-1", role: "warehouse" as const };
const ADMIN = { userId: "admin-1", role: "admin" as const };

describe("InventoryResponsibilityService", () => {
  it("accepts a free item once and rejects a concurrent second acceptance", async () => {
    const harness = createHarness(null);
    await expect(harness.service.acceptFree(harness.itemId, EMPLOYEE)).resolves.toMatchObject({
      responsibleUserId: EMPLOYEE.userId,
    });
    await expect(
      harness.service.acceptFree(harness.itemId, OWNER),
    ).rejects.toMatchObject({ publicCode: "item_already_assigned" });
  });

  it("creates one pending transfer and confirms it atomically", async () => {
    const harness = createHarness("owner-1");
    const transfer = await harness.service.requestTransfer(
      { itemId: harness.itemId },
      EMPLOYEE,
    );
    expect(transfer).toMatchObject({
      status: "pending_current_owner",
      version: 1,
    });
    await expect(
      harness.service.requestTransfer({ itemId: harness.itemId }, TECHNICIAN as never),
    ).rejects.toMatchObject({ kind: "forbidden" });
    const confirmed = await harness.service.decideTransfer(
      transfer.id,
      { version: 1, decision: "confirm" },
      OWNER,
    );
    expect(confirmed).toMatchObject({ status: "confirmed", version: 2 });
    expect(harness.state.responsibleUserId).toBe(EMPLOYEE.userId);
  });

  it("does not disclose the current owner's identity to a transfer requester", async () => {
    const harness = createHarness("owner-1");

    const transfer = await harness.service.requestTransfer(
      { itemId: harness.itemId },
      EMPLOYEE,
    );

    expect(transfer).not.toHaveProperty("currentResponsibleIdAtRequest");
    expect(transfer).not.toHaveProperty("currentResponsibleName");
    expect(transfer).not.toHaveProperty("requestedBy");
    expect(transfer).not.toHaveProperty("proposedResponsibleId");
    await expect(harness.service.listTransfers(EMPLOYEE)).resolves.toEqual([
      expect.not.objectContaining({
        currentResponsibleIdAtRequest: expect.anything(),
        currentResponsibleName: expect.anything(),
      }),
    ]);
  });

  it("lists a transfer only to its requester and saved current owner", async () => {
    const harness = createHarness(OWNER.userId);
    await harness.service.requestTransfer({ itemId: harness.itemId }, EMPLOYEE);

    await expect(harness.service.listTransfers(EMPLOYEE)).resolves.toHaveLength(1);
    await expect(harness.service.listTransfers(OWNER)).resolves.toHaveLength(1);
    await expect(harness.service.listTransfers(UNRELATED_EMPLOYEE)).resolves.toEqual([]);
  });

  it("requires a comment for rejection and checks the current owner", async () => {
    const harness = createHarness("owner-1");
    const transfer = await harness.service.requestTransfer(
      { itemId: harness.itemId },
      EMPLOYEE,
    );
    await expect(
      harness.service.decideTransfer(
        transfer.id,
        { version: 1, decision: "reject" },
        EMPLOYEE,
      ),
    ).rejects.toMatchObject({ publicCode: "forbidden" });
    await expect(
      harness.service.decideTransfer(
        transfer.id,
        { version: 1, decision: "reject" },
        OWNER,
      ),
    ).rejects.toMatchObject({ publicCode: "comment_required" });
  });

  it("does not assign an overridden transfer to an inactive or unknown user", async () => {
    const harness = createHarness(OWNER.userId);
    const transfer = await harness.service.requestTransfer(
      { itemId: harness.itemId },
      EMPLOYEE,
    );

    const inactiveUserId = "00000000-0000-4000-8000-000000000010";
    const unknownUserId = "00000000-0000-4000-8000-000000000011";
    harness.repository.activeUserIds.delete(inactiveUserId);
    await expect(
      harness.service.overrideTransfer(
        transfer.id,
        {
          version: transfer.version,
          reason: "Ownership correction",
          outcome: "assigned",
          responsibleUserId: inactiveUserId,
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({ publicCode: "responsible_user_not_available" });
    await expect(
      harness.service.overrideTransfer(
        transfer.id,
        {
          version: transfer.version,
          reason: "Ownership correction",
          outcome: "assigned",
          responsibleUserId: unknownUserId,
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({ publicCode: "responsible_user_not_available" });

    expect(harness.state.responsibleUserId).toBe(OWNER.userId);
    expect(harness.repository.transfer?.status).toBe("pending_current_owner");
  });

  it("returns an item responsibility timeline to inventory readers only", async () => {
    const harness = createHarness("owner-1");
    harness.repository.timeline.push({
      id: "period-1",
      kind: "responsibility",
      occurredAt: NOW,
      actorName: "Admin",
      responsibleName: "Owner",
      status: "accepted",
      detail: null,
      closedAt: null,
    });
    await expect(
      harness.service.listTimeline(harness.itemId, TECHNICIAN),
    ).resolves.toEqual([
      expect.objectContaining({ id: "period-1", occurredAt: NOW.toISOString() }),
    ]);
    await expect(
      harness.service.listTimeline(harness.itemId, EMPLOYEE),
    ).rejects.toMatchObject({ publicCode: "forbidden" });
  });
});

function createHarness(responsibleUserId: string | null) {
  const repository = new MemoryResponsibilityRepository(responsibleUserId);
  let id = 0;
  const repositories: InventoryResponsibilityRepositories = {
    responsibility: repository,
  };
  const unitOfWork: UnitOfWork<InventoryResponsibilityRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return {
    itemId: "00000000-0000-4000-8000-000000000001",
    state: repository.state,
    repository,
    service: new InventoryResponsibilityService(
      unitOfWork,
      { now: () => NOW },
      {
        create: () =>
          `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      },
    ),
  };
}

class MemoryResponsibilityRepository
  implements InventoryResponsibilityRepository
{
  readonly audits: AppendResponsibilityAuditRecord[] = [];
  readonly timeline: ResponsibilityTimelineRecord[] = [];
  readonly state: ItemResponsibilityState;
  readonly activeUserIds = new Set([
    "employee-1",
    "owner-1",
    "employee-2",
    "tech-1",
    "admin-1",
    "00000000-0000-4000-8000-000000000010",
  ]);
  transfer: TransferRecord | null = null;

  constructor(responsibleUserId: string | null) {
    this.state = {
      itemId: "00000000-0000-4000-8000-000000000001",
      responsibleUserId,
      responsibleName: responsibleUserId,
      itemStatus: "active",
    };
  }

  async findItemState() {
    return this.state;
  }

  async isUserActiveForUpdate(userId: string) {
    return this.activeUserIds.has(userId);
  }

  async findPendingTransfer() {
    return this.transfer?.status === "pending_current_owner"
      ? this.transfer
      : null;
  }

  async findTransfer() {
    return this.transfer;
  }

  async listTransfersForUser(userId: string) {
    return this.transfer &&
      (this.transfer.requestedBy === userId ||
        this.transfer.currentResponsibleIdAtRequest === userId)
      ? [this.transfer]
      : [];
  }

  async listTimeline() {
    return this.timeline;
  }

  async insertResponsibility(input: InsertResponsibilityRecord) {
    if (this.state.responsibleUserId) {
      const error = new Error("duplicate") as Error & { code: string };
      error.code = "23505";
      throw error;
    }
    this.state.responsibleUserId = input.responsibleUserId;
    this.state.responsibleName = input.responsibleUserId;
  }

  async closeResponsibility(input: CloseResponsibilityRecord) {
    void input;
    this.state.responsibleUserId = null;
    this.state.responsibleName = null;
  }

  async insertTransfer(input: InsertTransferRecord) {
    if (this.transfer?.status === "pending_current_owner") {
      const error = new Error("duplicate") as Error & { code: string };
      error.code = "23505";
      throw error;
    }
    this.transfer = {
      id: input.id,
      itemId: input.itemId,
      requestedBy: input.requestedBy,
      requestedByName: input.requestedBy,
      proposedResponsibleId: input.proposedResponsibleId,
      currentResponsibleIdAtRequest: input.currentResponsibleIdAtRequest,
      currentResponsibleName: input.currentResponsibleIdAtRequest,
      status: "pending_current_owner",
      requestedAt: input.requestedAt,
      closedAt: null,
      decisionComment: null,
      version: 1,
    };
    return this.transfer;
  }

  async decideTransfer(input: DecideTransferRecord) {
    if (!this.transfer || this.transfer.version !== input.version) return null;
    this.transfer = {
      ...this.transfer,
      status: input.status,
      closedAt: input.closedAt,
      decisionComment: input.decisionComment,
      version: this.transfer.version + 1,
    };
    return this.transfer;
  }

  async cancelTransfer(input: CancelTransferRecord) {
    if (!this.transfer || this.transfer.version !== input.version) return null;
    this.transfer = {
      ...this.transfer,
      status: "cancelled",
      closedAt: input.closedAt,
      version: this.transfer.version + 1,
    };
    return this.transfer;
  }

  async overrideTransfer(input: OverrideTransferRecord) {
    if (!this.transfer || this.transfer.version !== input.version) return null;
    this.transfer = {
      ...this.transfer,
      status: "overridden",
      closedAt: input.closedAt,
      version: this.transfer.version + 1,
    };
    return this.transfer;
  }

  async appendAudit(input: AppendResponsibilityAuditRecord) {
    this.audits.push(input);
  }
}
