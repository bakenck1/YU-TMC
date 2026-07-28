import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import { canAccessPath } from "@/lib/security/authorization";
import { sessionFromRequest } from "@/lib/security/session";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { validationError } from "@/lib/domain/application-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const headers = rateLimitHeaders(apiLimit);
  try {
    return Response.json(await getApplicationServices().settings.get(), {
      headers,
    });
  } catch (error) {
    return applicationErrorResponse(error, headers);
  }
}

export async function PATCH(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);
  const session = sessionFromRequest(request);
  if (!session) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }
  if (!canAccessPath(session.role, "/settings")) {
    return Response.json(
      { error: "forbidden" },
      { status: 403, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const headers = rateLimitHeaders(apiLimit);
  try {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw validationError("invalid_settings_payload");
    }

    const settings = await getApplicationServices().settings.update(input);
    return Response.json(settings, { headers });
  } catch (error) {
    return applicationErrorResponse(error, headers);
  }
}
