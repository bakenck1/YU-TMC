import type { CreateItInventoryItemInput } from "@/lib/contracts/inventory-items";
import { ApplicationError } from "@/lib/domain/application-error";
import { isItEquipmentType } from "@/lib/it-inventory";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  assertPhotoJsonRequest,
  readPhotoJsonRequest,
} from "@/lib/server/http/photo-request";
import {
  authorizationActor,
  requirePermission,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
};

export async function GET(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.it.read");
    const items = await getApplicationServices().items.listItItems(
      authorizationActor(user),
    );
    return Response.json({ items }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return applicationErrorResponse(error, PRIVATE_HEADERS);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.it.manage");
    assertPhotoJsonRequest(request, 4);
    const input = parseCreate(await readPhotoJsonRequest(request, 4));
    const item = await getApplicationServices().items.createItItem(
      input,
      authorizationActor(user),
    );
    return Response.json({ item }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return applicationErrorResponse(
      error instanceof SyntaxError ? invalidRequest() : error,
      PRIVATE_HEADERS,
    );
  }
}

function parseCreate(value: unknown): CreateItInventoryItemInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    typeof body.name !== "string" ||
    typeof body.roomId !== "string" ||
    !isItEquipmentType(body.itType) ||
    !Array.isArray(body.photos) ||
    body.photos.length < 1 ||
    body.photos.length > 4 ||
    "barcode" in body ||
    "inventoryNumber" in body ||
    "responsibleUserId" in body ||
    typeof body.quantity !== "number" ||
    (body.unitPrice !== undefined && typeof body.unitPrice !== "number") ||
    (body.networkAddresses !== undefined && !Array.isArray(body.networkAddresses))
  ) {
    throw invalidRequest();
  }
  const photos = body.photos.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
    const photo = value as Record<string, unknown>;
    if (
      typeof photo.imageDataUrl !== "string" ||
      !photo.imageDataUrl.startsWith("data:image/jpeg;base64,") ||
      !Number.isInteger(photo.width) ||
      !Number.isInteger(photo.height)
    ) throw invalidRequest();
    return {
      imageDataUrl: photo.imageDataUrl,
      width: photo.width as number,
      height: photo.height as number,
    };
  });
  const networkAddresses = (body.networkAddresses ?? []).map((value) => {
    if (!value || typeof value !== "object") throw invalidRequest();
    const address = value as Record<string, unknown>;
    for (const key of ["deviceLabel", "ipAddress", "macAddress"] as const) {
      if (address[key] !== undefined && address[key] !== null && typeof address[key] !== "string") {
        throw invalidRequest();
      }
    }
    return {
      deviceLabel: address.deviceLabel as string | null | undefined,
      ipAddress: address.ipAddress as string | null | undefined,
      macAddress: address.macAddress as string | null | undefined,
    };
  });
  return {
    name: body.name,
    roomId: body.roomId,
    itType: body.itType,
    description: body.description as string | null | undefined,
    brand: body.brand as string | null | undefined,
    model: body.model as string | null | undefined,
    quantity: body.quantity,
    unitPrice: body.unitPrice as number | undefined,
    photos,
    networkAddresses,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
