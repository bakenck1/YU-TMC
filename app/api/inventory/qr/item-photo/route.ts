import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { itemPhotoResponse } from "@/lib/server/http/photo-request";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const actor = authorizationActor(user);
    const url = new URL(request.url);
    const value = url.searchParams.get("value");
    const kind = url.searchParams.get("kind");
    if (!value || (kind !== "barcode" && kind !== "qr")) {
      throw new ApplicationError("validation", "invalid_request");
    }

    if (kind === "barcode") {
      const localPhoto = await getApplicationServices().localBarcodes.getScannedGroupPhoto(
        value,
        actor,
      );
      if (localPhoto) {
        return itemPhotoResponse(localPhoto.bytes, localPhoto.mimeType);
      }
    }

    const photo = await getApplicationServices().qr.resolveItemPhoto(
      value,
      actor,
      kind,
    );
    return itemPhotoResponse(photo.bytes, photo.mimeType);
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "item_photo_unavailable" }, { status: 503 });
  }
}
