import type { CreateLocalBarcodeTransferInput } from "@/lib/contracts/local-barcodes";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const url = new URL(request.url);
    const actor = authorizationActor(user);
    const value = url.searchParams.get("value");
    if (value) {
      const group = await getApplicationServices().localBarcodes.resolveBarcode(value, actor);
      return Response.json({ group }, { headers: PRIVATE });
    }
    const itemId = url.searchParams.get("itemId");
    if (!itemId) throw new ApplicationError("validation", "item_id_required");
    const distribution = await getApplicationServices().localBarcodes.getDistribution(itemId, actor);
    return Response.json({ distribution }, { headers: PRIVATE });
  } catch (error) {
    return error instanceof ApplicationError ? applicationErrorResponse(error, PRIVATE) : Response.json({ error: "local_barcodes_unavailable" }, { status: 503, headers: PRIVATE });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const input = parseTransfer(await readLimitedJson(request));
    const execution = await getApplicationServices().localBarcodes.transferIdempotent(input, authorizationActor(user), request.headers.get("idempotency-key"));
    return Response.json({ result: execution.result }, { status: 201, headers: { ...PRIVATE, ...(execution.replayed ? { "idempotency-replayed": "true" } : {}) } });
  } catch (error) {
    const normalizedError = error instanceof SyntaxError
      ? new ApplicationError("validation", "invalid_local_transfer")
      : error;
    return normalizedError instanceof ApplicationError ? applicationErrorResponse(normalizedError, PRIVATE) : Response.json({ error: "local_barcode_transfer_unavailable" }, { status: 503, headers: PRIVATE });
  }
}

function parseTransfer(value: unknown): CreateLocalBarcodeTransferInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("validation", "invalid_local_transfer");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "itemId",
    "sourceGroupId",
    "recipientUserId",
    "quantity",
    "sourceVersion",
    "comment",
  ]);
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    typeof input.itemId !== "string" ||
    (input.sourceGroupId !== null && typeof input.sourceGroupId !== "string") ||
    typeof input.recipientUserId !== "string" ||
    typeof input.quantity !== "number" ||
    typeof input.sourceVersion !== "number" ||
    !(
      input.comment === undefined ||
      input.comment === null ||
      typeof input.comment === "string"
    )
  ) {
    throw new ApplicationError("validation", "invalid_local_transfer");
  }
  return {
    itemId: input.itemId,
    sourceGroupId: input.sourceGroupId,
    recipientUserId: input.recipientUserId,
    quantity: input.quantity,
    sourceVersion: input.sourceVersion,
    comment: input.comment ?? null,
  };
}
