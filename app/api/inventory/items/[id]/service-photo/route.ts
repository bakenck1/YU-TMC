import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { itemPhotoResponse } from "@/lib/server/http/photo-request";
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
    if (!isUuid(id)) {
      throw new ApplicationError("validation", "invalid_id");
    }
    const photo = await getApplicationServices().items.getServiceItemPhoto(
      id,
      authorizationActor(user),
    );
    return itemPhotoResponse(photo.bytes, photo.mimeType);
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "photo_unavailable" }, { status: 503 });
  }
}
