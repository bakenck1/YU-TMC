import type {
  UpdateInventoryItemContentInput,
  UpdateInventoryItemProtectedInput,
} from "@/lib/contracts/inventory-items";
import { after } from "next/server";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
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
    const item = await getApplicationServices().items.findItem(
      id,
      authorizationActor(user),
    );
    return Response.json({ item });
  } catch (error) {
    return itemErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const body: unknown = await request.json();
    const actor = authorizationActor(user);
    const services = getApplicationServices();
    const serviceRequest = isServicePatch(body);
    const item =
      serviceRequest
        ? await services.items.sendToService(
            id,
            body.version,
            {
              serviceName: body.serviceName,
              reason: body.reason,
              ...(body.photo ? { photo: body.photo } : {}),
            },
            actor,
          )
        : isMaintenanceResolutionPatch(body)
        ? await services.items.resolveMaintenanceItem(
            id,
            { version: body.version, status: body.status },
            actor,
          )
        : isProtectedPatch(body)
        ? await services.items.updateProtected(
            id,
            parseProtected(body),
            actor,
          )
        : await services.items.updateContent(
            id,
            parseContent(body),
            actor,
          );
    if (serviceRequest && user.role === "employee") {
      after(async () => {
        const admins = (await services.users.listUsers())
          .filter((candidate) => candidate.role === "admin" && candidate.active)
          .map((candidate) => candidate.id);
        await services.push.notifyMaintenanceRequest({
          itemId: item.id,
          itemName: item.name,
          inventoryNumber: item.inventoryNumber,
          reason: body.reason,
          recipientIds: admins,
        });
      });
    }
    return Response.json({ item });
  } catch (error) {
    return itemErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function isMaintenanceResolutionPatch(value: unknown): value is {
  operation: "resolve_maintenance";
  version: number;
  status: "active" | "decommissioned";
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).operation === "resolve_maintenance" &&
      Number.isInteger((value as Record<string, unknown>).version) &&
      ((value as Record<string, unknown>).status === "active" ||
        (value as Record<string, unknown>).status === "decommissioned"),
  );
}

function isServicePatch(value: unknown): value is {
  operation: "send_to_service";
  version: number;
  serviceName: string;
  reason: string;
  photo?: { imageDataUrl: string; width: number; height: number };
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).operation === "send_to_service" &&
      Number.isInteger((value as Record<string, unknown>).version) &&
      typeof (value as Record<string, unknown>).serviceName === "string" &&
      typeof (value as Record<string, unknown>).reason === "string" &&
      (!((value as Record<string, unknown>).photo) ||
        isCameraPhoto((value as Record<string, unknown>).photo)),
  );
}

function isCameraPhoto(value: unknown): value is {
  imageDataUrl: string;
  width: number;
  height: number;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).imageDataUrl === "string" &&
      Number.isInteger((value as Record<string, unknown>).width) &&
      Number.isInteger((value as Record<string, unknown>).height),
  );
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    assertId(id);
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      !Number.isInteger((body as Record<string, unknown>).version)
    ) {
      throw invalidRequest();
    }
    await getApplicationServices().items.archiveItem(
      id,
      (body as { version: number }).version,
      authorizationActor(user),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return itemErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function isProtectedPatch(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    "roomId" in body ||
    "inventoryNumber" in body ||
    "status" in body ||
    "condition" in body ||
    "connectionStatus" in body ||
    "replaceQr" in body
  );
}

function parseContent(value: unknown): UpdateInventoryItemContentInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    !Number.isInteger(body.version) ||
    typeof body.name !== "string" ||
    (body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== "string") ||
    (body.itemType !== undefined && body.itemType !== null && typeof body.itemType !== "string") ||
    (body.brand !== undefined && body.brand !== null && typeof body.brand !== "string") ||
    (body.model !== undefined && body.model !== null && typeof body.model !== "string") ||
    (body.quantity !== undefined && body.quantity !== null && typeof body.quantity !== "number") ||
    (body.unitPrice !== undefined && body.unitPrice !== null && typeof body.unitPrice !== "number")
  ) {
    throw invalidRequest();
  }
  return {
    version: body.version as number,
    name: body.name,
    description: body.description as string | null | undefined,
    itemType: body.itemType as string | null | undefined,
    brand: body.brand as string | null | undefined,
    model: body.model as string | null | undefined,
    quantity: body.quantity as number | null | undefined,
    unitPrice: body.unitPrice as number | null | undefined,
  };
}

function parseProtected(value: Record<string, unknown>): UpdateInventoryItemProtectedInput {
  if (
    !Number.isInteger(value.version) ||
    typeof value.roomId !== "string" ||
    typeof value.inventoryNumber !== "string" ||
    (value.status !== "active" &&
      value.status !== "maintenance" &&
      value.status !== "decommissioned") ||
    (value.condition !== undefined &&
      value.condition !== "good" &&
      value.condition !== "needs_attention" &&
      value.condition !== "damaged") ||
    (value.connectionStatus !== undefined &&
      value.connectionStatus !== "connected" &&
      value.connectionStatus !== "disconnected" &&
      value.connectionStatus !== "not_applicable") ||
    (value.replaceQr !== undefined && typeof value.replaceQr !== "boolean") ||
    (value.qrReplaceReason !== undefined &&
      value.qrReplaceReason !== null &&
      typeof value.qrReplaceReason !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    version: value.version as number,
    roomId: value.roomId,
    inventoryNumber: value.inventoryNumber,
    status: value.status,
    condition: value.condition as UpdateInventoryItemProtectedInput["condition"],
    connectionStatus:
      value.connectionStatus as UpdateInventoryItemProtectedInput["connectionStatus"],
    replaceQr: value.replaceQr as boolean | undefined,
    qrReplaceReason: value.qrReplaceReason as string | null | undefined,
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

function itemErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "items_unavailable" }, { status: 503 });
}
