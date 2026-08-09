import { ApplicationError } from "@/lib/domain/application-error";
import { readLimitedJson } from "@/lib/server/http/request-body";

export const MAX_LOGIN_JSON_BYTES = 4 * 1024;

export function assertLoginJsonRequest(request: Request): void {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType?.toLowerCase() !== "application/json") {
    throw new ApplicationError("unsupported_media_type", "unsupported_media_type");
  }

  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return;
  if (!/^\d+$/.test(rawLength)) {
    throw new ApplicationError("validation", "invalid_request");
  }
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_LOGIN_JSON_BYTES) {
    throw new ApplicationError("payload_too_large", "payload_too_large");
  }
}

export async function readLoginJsonRequest(request: Request): Promise<unknown> {
  try {
    return await readLimitedJson(request, MAX_LOGIN_JSON_BYTES);
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new SyntaxError("Invalid JSON request body");
  }
}
