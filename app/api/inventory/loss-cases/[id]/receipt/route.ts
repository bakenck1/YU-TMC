import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  assertPhotoJsonRequest,
  itemPhotoResponse,
  readPhotoJsonRequest,
} from "@/lib/server/http/photo-request";
import { normalizeUploadedPhoto } from "@/lib/server/photos/normalize-uploaded-photo";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireCurrentUser(request);
    const { id } = await params;
    const receipt = await getApplicationServices().assetLosses.getReceipt(
      id,
      authorizationActor(actor),
    );
    return itemPhotoResponse(receipt.bytes, receipt.mediaType);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireCurrentUser(request);
    assertPhotoJsonRequest(request);
    const body = await readPhotoJsonRequest(request) as Record<string, unknown>;
    const photo = body.photo as Record<string, unknown> | undefined;
    if (!photo || typeof photo.imageDataUrl !== "string") throw invalidRequest();
    const receipt = await normalizeUploadedPhoto(photo.imageDataUrl);
    const { id } = await params;
    const lossCase = await getApplicationServices().assetLosses.submitReceipt(
      id,
      receipt,
      authorizationActor(actor),
    );
    return Response.json({ lossCase }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_loss_receipt");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_NO_STORE)
    : Response.json({ error: "loss_receipt_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
}
