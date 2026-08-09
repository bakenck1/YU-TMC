import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { validationError } from "@/lib/domain/application-error";
import { requirePermission } from "@/lib/server/security/request-user";

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
    await requirePermission(request, "legacy.settings.manage");
    let input: unknown;
    try {
      input = await readLimitedJson(request);
    } catch {
      throw validationError("invalid_settings_payload");
    }

    const settings = await getApplicationServices().settings.update(input);
    return Response.json(settings, { headers });
  } catch (error) {
    return applicationErrorResponse(error, headers);
  }
}
