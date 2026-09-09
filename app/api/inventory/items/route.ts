import type { CreateInventoryItemInput } from "@/lib/contracts/inventory-items";
import {
  isInventoryItemCategory,
  type InventoryItemCategory,
} from "@/lib/inventory-categories";
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
    assertPhotoJsonRequest(request, 4);
    const input = parseCreate(
      await readPhotoJsonRequest(request, 4),
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
    !isInventoryItemCategory(body.category) ||
    typeof body.roomId !== "string" ||
    (!restricted && !body.photo && !body.photos) ||
    (body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== "string") ||
    (body.brand !== undefined && body.brand !== null && typeof body.brand !== "string") ||
    (body.model !== undefined && body.model !== null && typeof body.model !== "string") ||
    (body.quantity !== undefined && body.quantity !== null && typeof body.quantity !== "number") ||
    (body.unitPrice !== undefined && body.unitPrice !== null && typeof body.unitPrice !== "number") ||
    (body.barcode !== undefined &&
      body.barcode !== null &&
      typeof body.barcode !== "string") ||
    (body.inventoryNumber !== undefined &&
      body.inventoryNumber !== null &&
      typeof body.inventoryNumber !== "string") ||
    (body.responsibleUserId !== undefined &&
      body.responsibleUserId !== null &&
      typeof body.responsibleUserId !== "string")
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
  // SECURITY: reject data URIs that are not well-formed image data URLs.
  const ALLOWED_DATA_URL_PREFIXES = [
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
  ];
  if (photo && !ALLOWED_DATA_URL_PREFIXES.some((prefix) => (photo.imageDataUrl as string).startsWith(prefix))) {
    throw invalidRequest();
  }
  const photosValue = body.photos === undefined ? (photo ? [photo] : []) : body.photos;
  if (!Array.isArray(photosValue) || photosValue.length > 4 || (!restricted && photosValue.length < 1)) {
    throw invalidRequest();
  }
  const photos = photosValue.map((value) => {
    if (!value || typeof value !== "object") throw invalidRequest();
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.imageDataUrl !== "string" ||
      !Number.isInteger(candidate.width) ||
      !Number.isInteger(candidate.height) ||
      !ALLOWED_DATA_URL_PREFIXES.some((prefix) => (candidate.imageDataUrl as string).startsWith(prefix))
    ) throw invalidRequest();
    return {
      imageDataUrl: candidate.imageDataUrl as string,
      width: candidate.width as number,
      height: candidate.height as number,
    };
  });
  return {
    name: body.name,
    category: body.category as InventoryItemCategory,
    roomId: body.roomId,
    description: body.description as string | null | undefined,
    brand: body.brand as string | null | undefined,
    model: body.model as string | null | undefined,
    quantity: body.quantity as number | null | undefined,
    unitPrice: body.unitPrice as number | null | undefined,
    barcode: body.barcode as string | null | undefined,
    inventoryNumber: body.inventoryNumber as string | null | undefined,
    responsibleUserId: body.responsibleUserId as string | null | undefined,
    photos,
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
