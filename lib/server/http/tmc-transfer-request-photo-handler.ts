import "server-only";

import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { itemPhotoResponse } from "@/lib/server/http/photo-request";

export function createTmcTransferRequestPhotoGetHandler(dependencies: {
  authenticate(request: Request): Promise<{
    userId: string;
    role: UserRole;
    sessionVersion?: number;
  }>;
  getItemPhoto(
    requestId: string,
    itemId: string,
    actor: { userId: string; role: UserRole; sessionVersion?: number },
  ): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" }>;
}) {
  return async function get(
    request: Request,
    requestId: string,
    itemId: string,
  ): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const photo = await dependencies.getItemPhoto(requestId, itemId, actor);
      return itemPhotoResponse(photo.bytes, photo.mimeType);
    } catch (error) {
      return error instanceof ApplicationError
        ? applicationErrorResponse(error, { "cache-control": "no-store" })
        : Response.json(
            { error: "photo_unavailable" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
    }
  };
}
