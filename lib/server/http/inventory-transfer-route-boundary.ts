import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

const NO_STORE_HEADER = "no-store";

export function parseLegacyTransferId(value: string): string {
  if (!isUuid(value)) {
    throw new ApplicationError("not_found", "transfer_not_found");
  }
  return value.toLowerCase();
}

export function legacyTransferJsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", NO_STORE_HEADER);
  return Response.json(body, { ...init, headers });
}

export function legacyTransferErrorResponse(error: unknown): Response {
  const headers = new Headers({ "cache-control": NO_STORE_HEADER });
  const retryAfter =
    error instanceof ApplicationError && error.kind === "rate_limited"
      ? error.safeDetails?.retryAfterSeconds
      : undefined;
  if (retryAfter && /^[1-9]\d{0,8}$/.test(retryAfter)) {
    headers.set("retry-after", retryAfter);
  }

  return error instanceof ApplicationError
    ? applicationErrorResponse(error, headers)
    : legacyTransferJsonResponse(
        { error: "transfer_unavailable" },
        { status: 503, headers },
      );
}
