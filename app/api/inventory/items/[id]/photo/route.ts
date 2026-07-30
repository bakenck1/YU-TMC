import type { UpdateInventoryItemPhotoInput } from "@/lib/contracts/inventory-items";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
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
    return new Response(photo.bytes.buffer as ArrayBuffer, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-type": photo.mimeType,
      },
    });
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
    const item = await getApplicationServices().items.updatePhoto(
      id,
      parsePhoto(await request.json()),
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
  return {
    version: body.version as number,
    imageDataUrl: body.imageDataUrl,
    width: body.width as number,
    height: body.height as number,
  };
}

function assertId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
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
