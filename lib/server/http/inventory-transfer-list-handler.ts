import "server-only";

import type { TransferDto } from "@/lib/contracts/inventory-responsibility";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

const PRIVATE_RESPONSE_CACHE_CONTROL =
  "private, no-store, max-age=0, must-revalidate";

interface AuthenticatedTransferListActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export function createInventoryTransferListGetHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedTransferListActor>;
  listTransfers(
    actor: AuthenticatedTransferListActor,
  ): Promise<TransferDto[]>;
}) {
  return async function get(request: Request): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const transfers = await dependencies.listTransfers(actor);
      return Response.json(
        { transfers },
        { headers: privateHeaders() },
      );
    } catch (error) {
      const headers = privateHeaders(error);
      return error instanceof ApplicationError
        ? applicationErrorResponse(error, headers)
        : Response.json(
            { error: "transfer_unavailable" },
            { status: 503, headers },
          );
    }
  };
}

function privateHeaders(error?: unknown): HeadersInit {
  const retryAfter =
    error instanceof ApplicationError && error.kind === "rate_limited"
      ? error.safeDetails?.retryAfterSeconds
      : undefined;
  return {
    "cache-control": PRIVATE_RESPONSE_CACHE_CONTROL,
    ...(retryAfter && /^[1-9]\d{0,8}$/.test(retryAfter)
      ? { "retry-after": retryAfter }
      : {}),
  };
}
