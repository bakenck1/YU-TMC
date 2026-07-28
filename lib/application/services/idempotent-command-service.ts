import type {
  IdempotencyRequestInput,
  IdempotencyResponse,
  IdempotencyRequestRepository,
} from "@/lib/application/ports/inventory-concurrency-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";

export type IdempotentCommandResult =
  | { kind: "completed"; response: IdempotencyResponse }
  | { kind: "replayed"; response: IdempotencyResponse };

/**
 * Uses one UnitOfWork transaction for reserve, domain mutation and completion.
 * Throwing from `work` rolls the reservation back, so the same key remains
 * available for a retry.
 */
export async function executeIdempotentCommand<Repositories extends {
  idempotency: IdempotencyRequestRepository;
}>(
  unitOfWork: UnitOfWork<Repositories>,
  input: IdempotencyRequestInput,
  now: Date,
  work: (repositories: Repositories) => Promise<IdempotencyResponse>,
): Promise<IdempotentCommandResult> {
  return unitOfWork.transaction(async (repositories) => {
    const repository = repositories.idempotency;
    const reservation = await repository.reserve(input);

    if (reservation.kind === "replay") {
      return { kind: "replayed", response: reservation.response };
    }
    if (reservation.kind === "key_reused") {
      throw new ApplicationError("conflict", "idempotency_key_reused");
    }
    if (reservation.kind === "in_progress") {
      throw new ApplicationError("conflict", "idempotency_request_in_progress");
    }

    const response = await work(repositories);
    await repository.complete(reservation.id, response, now);
    return { kind: "completed", response };
  });
}
