import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body = await readLimitedJson(request, 16 * 1024);
    await getApplicationServices().push.subscribe(
      body as Record<string, unknown>,
      authorizationActor(user),
      request.headers.get("user-agent"),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return pushErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body = (await readLimitedJson(request, 8 * 1024)) as { endpoint?: unknown };
    await getApplicationServices().push.unsubscribe(
      body?.endpoint,
      authorizationActor(user),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return pushErrorResponse(error);
  }
}

function pushErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return applicationErrorResponse(
      new ApplicationError("validation", "invalid_request"),
    );
  }
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "push_unavailable" }, { status: 503 });
}
