import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import { canAccessPath } from "@/lib/security/authorization";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { validationError } from "@/lib/domain/application-error";
import { requireCurrentUser } from "@/lib/server/security/request-user";

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
  const headers = rateLimitHeaders(apiLimit);
  try {
    const user = await requireCurrentUser(request);
    if (!canAccessPath(user.role, "/settings")) {
      return Response.json(
        { error: "forbidden" },
        { status: 403, headers },
      );
    }
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
