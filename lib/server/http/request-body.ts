import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";

export const DEFAULT_JSON_BODY_LIMIT = 64 * 1024;

function assertContentLength(request: Request, maximumBytes: number) {
  const rawLength = request.headers.get("content-length");
  if (rawLength === null) return;
  if (!/^\d+$/.test(rawLength)) {
    throw new ApplicationError("validation", "invalid_request");
  }
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > maximumBytes) {
    throw new ApplicationError("payload_too_large", "payload_too_large");
  }
}

function requireMediaType(request: Request, expected: string) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType?.toLowerCase() !== expected) {
    throw new ApplicationError("unsupported_media_type", "unsupported_media_type");
  }
}

export async function readLimitedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  assertContentLength(request, maximumBytes);
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError("validation", "invalid_request");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
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
  return bytes;
}

export async function readLimitedJson(
  request: Request,
  maximumBytes = DEFAULT_JSON_BODY_LIMIT,
): Promise<unknown> {
  requireMediaType(request, "application/json");
  const bytes = await readLimitedBody(request, maximumBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApplicationError("validation", "invalid_request");
  }
}

export async function readLimitedFormData(
  request: Request,
  maximumBytes: number,
): Promise<FormData> {
  requireMediaType(request, "multipart/form-data");
  const bytes = await readLimitedBody(request, maximumBytes);
  const boundedBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(boundedBody).set(bytes);
  const boundedRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type")! },
    body: boundedBody,
  });
  try {
    return await boundedRequest.formData();
  } catch {
    throw new ApplicationError("validation", "invalid_request");
  }
}
