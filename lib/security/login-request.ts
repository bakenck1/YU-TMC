import { ApplicationError } from "@/lib/domain/application-error";

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
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON request body");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_LOGIN_JSON_BYTES) {
      await reader.cancel();
      throw new ApplicationError("payload_too_large", "payload_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SyntaxError("Invalid JSON request body");
  }
}
