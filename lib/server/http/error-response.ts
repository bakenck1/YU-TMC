import "server-only";

import {
  ApplicationError,
  type ApplicationErrorKind,
} from "@/lib/domain/application-error";

const STATUS_BY_KIND: Readonly<Record<ApplicationErrorKind, number>> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  unavailable: 503,
};

export function applicationErrorResponse(
  error: unknown,
  headers?: HeadersInit,
): Response {
  if (error instanceof ApplicationError) {
    return Response.json(
      {
        error: error.publicCode,
        ...(error.safeDetails ? { details: error.safeDetails } : {}),
      },
      {
        status: STATUS_BY_KIND[error.kind],
        headers,
      },
    );
  }

  return Response.json(
    { error: "internal_error" },
    { status: 500, headers },
  );
}
