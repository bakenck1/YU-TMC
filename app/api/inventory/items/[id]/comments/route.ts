import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  readLimitedFormData,
  readLimitedJson,
} from "@/lib/server/http/request-body";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SECURITY: allowlist of permitted attachment MIME types.
// Arbitrary client-supplied types (e.g. "text/html") are rejected to prevent
// stored-XSS / content-sniffing attacks if the Content-Type header is ever
// reflected back to browsers.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILE_NAME_LENGTH = 255;

function sanitizeFileName(raw: string): string {
  // Strip path separators and control characters; collapse to a safe basename.
  return raw
    .replace(/[/\\]/g, "_")          // path traversal chars
    .replace(/[\x00-\x1f\x7f]/g, "") // control characters
    .slice(0, MAX_FILE_NAME_LENGTH)
    || "attachment";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    // SECURITY: validate UUID format before passing to domain layer.
    if (!isUuid(id)) throw new ApplicationError("validation", "invalid_id");
    const comments = await getApplicationServices().items.listComments(
      id,
      authorizationActor(user),
    );
    return Response.json({ comments });
  } catch (error) {
    return commentsErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    // SECURITY: validate UUID format before passing to domain layer.
    if (!isUuid(id)) throw new ApplicationError("validation", "invalid_id");
    const contentType = request.headers.get("content-type") ?? "";
    let message: unknown;
    let attachment:
      | { fileName: string; mediaType: string; binaryData: Uint8Array }
      | undefined;
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const form = await readLimitedFormData(request, 2 * 1024 * 1024 + 64 * 1024);
      message = form.get("message");
      const file = form.get("attachment");
      if (file instanceof File && file.size > 0) {
        if (file.size > 2 * 1024 * 1024) throw invalidAttachment();
        // SECURITY: reject MIME types not on the allowlist. The client controls
        // the file.type value in multipart, so we must not trust it blindly.
        if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) throw invalidAttachment();
        attachment = {
          fileName: sanitizeFileName(file.name),
          mediaType: file.type,
          binaryData: new Uint8Array(await file.arrayBuffer()),
        };
      }
    } else {
      const body = await readLimitedJson(request, 16 * 1024);
      if (!body || typeof body !== "object") throw invalidRequest();
      message = (body as Record<string, unknown>).message;
    }
    const comments = await getApplicationServices().items.addComment(
      id,
      message,
      authorizationActor(user),
      attachment,
    );
    return Response.json({ comments }, { status: 201 });
  } catch (error) {
    return commentsErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function invalidAttachment() {
  return new ApplicationError("validation", "invalid_comment_attachment");
}

function commentsErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "item_comments_unavailable" }, { status: 503 });
}
