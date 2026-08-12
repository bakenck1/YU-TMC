import type { CreateInventoryItemInput } from "@/lib/contracts/inventory-items";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";
import {
  assertPhotoJsonRequest,
  readPhotoJsonRequest,
} from "@/lib/server/http/photo-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const items = await getApplicationServices().items.listItems(
      authorizationActor(user),
    );
    return Response.json({ items });
  } catch (error) {
    return itemErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const actor = authorizationActor(user);
    assertPhotoJsonRequest(request);
    const input = parseCreate(
      await readPhotoJsonRequest(request),
      actor.role === "warehouse",
    );
    const item = await getApplicationServices().items.createItem(
      input,
      actor,
    );
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return itemErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseCreate(
  value: unknown,
  restricted: boolean,
): CreateInventoryItemInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    typeof body.name !== "string" ||
    typeof body.roomId !== "string" ||
    (!restricted && typeof body.barcode !== "string") ||
    (!restricted && (!body.photo || typeof body.photo !== "object")) ||
    (body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== "string") ||
    (body.itemType !== undefined && body.itemType !== null && typeof body.itemType !== "string") ||
    (body.brand !== undefined && body.brand !== null && typeof body.brand !== "string") ||
    (body.model !== undefined && body.model !== null && typeof body.model !== "string") ||
    (body.quantity !== undefined && body.quantity !== null && typeof body.quantity !== "number") ||
    (body.unitPrice !== undefined && body.unitPrice !== null && typeof body.unitPrice !== "number") ||
    (body.barcode !== undefined &&
      body.barcode !== null &&
      typeof body.barcode !== "string") ||
    (body.inventoryNumber !== undefined &&
      body.inventoryNumber !== null &&
      typeof body.inventoryNumber !== "string")
  ) {
    throw invalidRequest();
  }
  const photo = body.photo === undefined || body.photo === null
    ? null
    : body.photo as Record<string, unknown>;
  if (photo && (
    typeof photo.imageDataUrl !== "string" ||
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height)
  )) throw invalidRequest();
  return {
    name: body.name,
    roomId: body.roomId,
    description: body.description as string | null | undefined,
    itemType: body.itemType as string | null | undefined,
    brand: body.brand as string | null | undefined,
    model: body.model as string | null | undefined,
    quantity: body.quantity as number | null | undefined,
    unitPrice: body.unitPrice as number | null | undefined,
    barcode: body.barcode as string | null | undefined,
    inventoryNumber: body.inventoryNumber as string | null | undefined,
    photo: photo ? {
      imageDataUrl: photo.imageDataUrl as string,
      width: photo.width as number,
      height: photo.height as number,
    } : undefined,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function itemErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "items_unavailable" }, { status: 503 });
}
