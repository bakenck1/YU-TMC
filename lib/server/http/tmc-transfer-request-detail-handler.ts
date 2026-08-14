import "server-only";

import type { TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

export function createTmcTransferRequestDetailGetHandler(dependencies: {
  authenticate(request: Request): Promise<{
    userId: string;
    role: UserRole;
    sessionVersion?: number;
  }>;
  getById(
    id: string,
    actor: { userId: string; role: UserRole; sessionVersion?: number },
  ): Promise<TmcTransferRequestDto>;
}) {
  return async function get(request: Request, id: string): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const transferRequest = await dependencies.getById(id, actor);
      return Response.json(
        { request: transferRequest },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (!(error instanceof ApplicationError)) {
        return applicationErrorResponse(error, { "cache-control": "no-store" });
      }
      return applicationErrorResponse(error, { "cache-control": "no-store" });
    }
  };
}
