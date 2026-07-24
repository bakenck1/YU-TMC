import { NextRequest } from "next/server";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  SESSION_COOKIE_NAME,
  sessionUser,
  verifySessionToken,
} from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }

  return Response.json(
    { authenticated: true, user: sessionUser(session) },
    { headers: rateLimitHeaders(apiLimit) },
  );
}
