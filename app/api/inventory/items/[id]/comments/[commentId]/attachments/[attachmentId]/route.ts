import { Buffer } from "node:buffer";

import { ApplicationError } from "@/lib/domain/application-error";
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
  context: {
    params: Promise<{ id: string; commentId: string; attachmentId: string }>;
  },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id, commentId, attachmentId } = await context.params;
    const attachment = await getApplicationServices().items.findCommentAttachment(
      id,
      commentId,
      attachmentId,
      authorizationActor(user),
    );
    return new Response(Buffer.from(attachment.binaryData), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": attachmentDisposition(attachment.fileName),
        "content-length": String(attachment.sizeBytes),
        "content-type": attachment.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "comment_attachment_unavailable" }, { status: 503 });
  }
}

function attachmentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "attachment";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
