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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await params;
    const photo = await getApplicationServices().requests.getPhoto(
      id,
      authorizationActor(user),
    );
    return itemPhotoResponse(photo.bytes, photo.mediaType);
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "service_request_photo_unavailable" }, { status: 503 });
  }
}
