import type { UpdateInventoryItemPhotoInput } from "@/lib/contracts/inventory-items";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  assertPhotoJsonRequest,
  itemPhotoResponse,
  readPhotoJsonRequest,
} from "@/lib/server/http/photo-request";
import { readLimitedJson } from "@/lib/server/http/request-body";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const photo = await getApplicationServices().items.getItemPhoto(
      id,
      authorizationActor(user),
    );
    return itemPhotoResponse(photo.bytes, photo.mimeType);
  } catch (error) {
    return photoErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    assertPhotoJsonRequest(request);
    const item = await getApplicationServices().items.updatePhoto(
      id,
      parsePhoto(await readPhotoJsonRequest(request)),
      authorizationActor(user),
    );
    return Response.json({ item });
  } catch (error) {
    return photoErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const body = await readLimitedJson(request, 8 * 1024);
    if (
      !body ||
      typeof body !== "object" ||
      !Number.isInteger((body as Record<string, unknown>).version)
    ) throw invalidRequest();
    const item = await getApplicationServices().items.removePhoto(
      id,
      (body as { version: number }).version,
      authorizationActor(user),
    );
    return Response.json({ item });
  } catch (error) {
    return photoErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parsePhoto(value: unknown): UpdateInventoryItemPhotoInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    !Number.isInteger(body.version) ||
    typeof body.imageDataUrl !== "string" ||
    !Number.isInteger(body.width) ||
    !Number.isInteger(body.height)
  ) {
    throw invalidRequest();
  }
  // TypeScript does not narrow body[key] after the guard above, so we extract
  // the already-verified string into a typed local before the prefix check.
  const imageDataUrl: string = body.imageDataUrl;
  // SECURITY: reject data URIs that are not well-formed image data URLs.
  // Prevents arbitrary string payloads from reaching the image processing
  // pipeline and reduces the attack surface for content injection.
  const ALLOWED_DATA_URL_PREFIXES = [
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
  ];
  if (!ALLOWED_DATA_URL_PREFIXES.some((prefix) => imageDataUrl.startsWith(prefix))) {
    throw invalidRequest();
  }
  return {
    version: body.version as number,
    imageDataUrl,
    width: body.width as number,
    height: body.height as number,
  };
}


function assertId(id: string) {
  if (!isUuid(id)) {
    throw new ApplicationError("validation", "invalid_id");
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function photoErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "photo_unavailable" }, { status: 503 });
}
