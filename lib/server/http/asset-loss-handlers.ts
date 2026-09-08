import type { AssetLossService } from "@/lib/application/services/asset-loss-service";
import type { AssetLossActor } from "@/lib/application/services/asset-loss-service";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { assertPhotoJsonRequest, itemPhotoResponse, readPhotoJsonRequest } from "@/lib/server/http/photo-request";
import { readLimitedJson } from "@/lib/server/http/request-body";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

interface CollectionDependencies {
  authenticate(request: Request): Promise<AssetLossActor>;
  service: Pick<AssetLossService, "list" | "create">;
}

interface ReceiptDependencies {
  authenticate(request: Request): Promise<AssetLossActor>;
  normalize(imageDataUrl: string): Promise<{ bytes: Uint8Array; width: number; height: number; mediaType: "image/jpeg" }>;
  service: Pick<AssetLossService, "getReceipt" | "submitReceipt">;
}

interface ReviewDependencies {
  authenticate(request: Request): Promise<AssetLossActor>;
  service: Pick<AssetLossService, "review">;
}

export function createAssetLossCollectionHandlers(dependencies: CollectionDependencies) {
  return {
    GET: async (request: Request) => {
      try {
        const actor = await dependencies.authenticate(request);
        const url = new URL(request.url);
        if ([...url.searchParams.keys()].some((key) => key !== "cursor") || url.searchParams.getAll("cursor").length > 1) throw invalid("invalid_loss_query");
        return Response.json(await dependencies.service.list(actor, url.searchParams.get("cursor") ?? undefined), { headers: NO_STORE });
      } catch (error) { return safeError(error, "loss_cases_unavailable"); }
    },
    POST: async (request: Request) => {
      try {
        const actor = await dependencies.authenticate(request);
        const body = objectBody(await readLimitedJson(request), "invalid_loss_request");
        if (typeof body.itemId !== "string" || (body.employeeId !== undefined && typeof body.employeeId !== "string") || (body.amount !== undefined && typeof body.amount !== "string") || !onlyKeys(body, ["itemId", "employeeId", "amount"])) throw invalid("invalid_loss_request");
        const lossCase = await dependencies.service.create({ itemId: body.itemId, employeeId: body.employeeId as string | undefined, amount: body.amount as string | undefined }, actor);
        return Response.json({ lossCase }, { status: 201, headers: NO_STORE });
      } catch (error) { return safeError(error, "loss_cases_unavailable"); }
    },
  };
}

export function createAssetLossReceiptHandlers(dependencies: ReceiptDependencies) {
  return {
    GET: async (request: Request, id: string) => {
      try {
        const actor = await dependencies.authenticate(request);
        const receipt = await dependencies.service.getReceipt(id, actor);
        return itemPhotoResponse(receipt.bytes, receipt.mediaType);
      } catch (error) { return safeError(error, "loss_receipt_unavailable"); }
    },
    POST: async (request: Request, id: string) => {
      try {
        const actor = await dependencies.authenticate(request);
        assertPhotoJsonRequest(request);
        const body = objectBody(await readPhotoJsonRequest(request), "invalid_loss_receipt");
        const photo = body.photo;
        if (!photo || typeof photo !== "object" || Array.isArray(photo)) throw invalid("invalid_loss_receipt");
        const photoBody = photo as Record<string, unknown>;
        if (typeof photoBody.imageDataUrl !== "string" || !onlyKeys(body, ["photo"]) || !onlyKeys(photoBody, ["imageDataUrl"])) throw invalid("invalid_loss_receipt");
        const lossCase = await dependencies.service.submitReceipt(id, await dependencies.normalize(photoBody.imageDataUrl), actor);
        return Response.json({ lossCase }, { headers: NO_STORE });
      } catch (error) { return safeError(error instanceof SyntaxError ? invalid("invalid_loss_receipt") : error, "loss_receipt_unavailable"); }
    },
  };
}

export function createAssetLossReviewHandler(dependencies: ReviewDependencies) {
  return async (request: Request, id: string) => {
    try {
      const actor = await dependencies.authenticate(request);
      const body = objectBody(await readLimitedJson(request), "invalid_loss_review");
      if ((body.decision !== "approved" && body.decision !== "rejected") || (body.comment !== undefined && typeof body.comment !== "string") || !onlyKeys(body, ["decision", "comment"])) throw invalid("invalid_loss_review");
      const lossCase = await dependencies.service.review(id, { decision: body.decision, comment: body.comment as string | undefined }, actor);
      return Response.json({ lossCase }, { headers: NO_STORE });
    } catch (error) { return safeError(error, "loss_review_unavailable"); }
  };
}

function objectBody(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(code);
  return value as Record<string, unknown>;
}
function onlyKeys(body: Record<string, unknown>, keys: string[]) { return Object.keys(body).every((key) => keys.includes(key)); }
function invalid(code: string) { return new ApplicationError("validation", code); }
function safeError(error: unknown, fallback: string) {
  return error instanceof ApplicationError ? applicationErrorResponse(error, NO_STORE) : Response.json({ error: fallback }, { status: 503, headers: NO_STORE });
}
