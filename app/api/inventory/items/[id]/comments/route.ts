import { ApplicationError } from "@/lib/domain/application-error";
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
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
        attachment = {
          fileName: file.name,
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
