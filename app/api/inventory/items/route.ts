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
    assertPhotoJsonRequest(request);
    const input = parseCreate(await readPhotoJsonRequest(request));
    const item = await getApplicationServices().items.createItem(
      input,
      authorizationActor(user),
    );
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return itemErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseCreate(value: unknown): CreateInventoryItemInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    typeof body.name !== "string" ||
    typeof body.roomId !== "string" ||
    typeof body.barcode !== "string" ||
    !body.photo ||
    typeof body.photo !== "object" ||
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
  const photo = body.photo as Record<string, unknown>;
  if (
    typeof photo.imageDataUrl !== "string" ||
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height)
  ) throw invalidRequest();
  return {
    name: body.name,
    roomId: body.roomId,
    description: body.description as string | null | undefined,
    itemType: body.itemType as string | null | undefined,
    brand: body.brand as string | null | undefined,
    model: body.model as string | null | undefined,
    quantity: body.quantity as number | null | undefined,
    unitPrice: body.unitPrice as number | null | undefined,
    barcode: body.barcode,
    inventoryNumber: body.inventoryNumber as string | null | undefined,
    photo: {
      imageDataUrl: photo.imageDataUrl,
      width: photo.width as number,
      height: photo.height as number,
    },
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
