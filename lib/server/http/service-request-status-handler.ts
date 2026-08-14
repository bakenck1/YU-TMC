import "server-only";

import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const MAXIMUM_BODY_BYTES = 4 * 1024;
const MAXIMUM_VERSION = 2_147_483_647;
const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
};

interface AuthenticatedServiceRequestActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export function createServiceRequestStatusPatchHandler(dependencies: {
  authenticate(request: Request): Promise<AuthenticatedServiceRequestActor>;
  updateStatus(
    serviceRequestId: string,
    status: ServiceRequestStatus,
    version: number,
    actor: AuthenticatedServiceRequestActor,
  ): Promise<ServiceRequestDto>;
}) {
  return async function patch(
    request: Request,
    serviceRequestId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const input = parseInput(
        await readLimitedJson(request, MAXIMUM_BODY_BYTES),
      );
      const serviceRequest = await dependencies.updateStatus(
        serviceRequestId,
        input.status,
        input.version,
        actor,
      );
      return Response.json(
        { request: serviceRequest },
        { headers: PRIVATE_RESPONSE_HEADERS },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function parseInput(value: unknown): {
  status: ServiceRequestStatus;
  version: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const input = value as Record<string, unknown>;
  if (
    (input.status !== "new" &&
      input.status !== "in_progress" &&
      input.status !== "completed") ||
    !Number.isSafeInteger(input.version) ||
    (input.version as number) < 1 ||
    (input.version as number) > MAXIMUM_VERSION
  ) {
    throw invalidRequest();
  }
  return {
    status: input.status,
    version: input.version as number,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_service_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_RESPONSE_HEADERS)
    : Response.json(
        { error: "service_requests_unavailable" },
        { status: 503, headers: PRIVATE_RESPONSE_HEADERS },
      );
}
