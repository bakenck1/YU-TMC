import { NextRequest, NextResponse } from "next/server";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  SESSION_COOKIE_NAME,
  expiredSessionCookieOptions,
  verifySessionToken,
} from "@/lib/security/session";
import { getApplicationServices } from "@/lib/server/application";
import { emitLegacyUsage, observeHttpRequest } from "@/lib/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return observeHttpRequest(request, "/api/auth/session", () => readSession(request));
}

async function readSession(request: NextRequest) {
  const apiLimit = await consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let user;
  try {
    user = await getApplicationServices().users.resolveCurrentAccount(
      session.sub,
    );
  } catch {
    emitLegacyUsage({ compatibilityId: "LEGACY-COOKIE-CONTRACT", variant: "v1", outcome: "failed" });
    return Response.json(
      { error: "authentication_unavailable" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (!user || user.sessionVersion !== session.ver) {
    emitLegacyUsage({
      compatibilityId: "LEGACY-COOKIE-CONTRACT",
      variant: "v1",
      outcome: user ? "session_version_mismatch" : "rejected",
    });
    const response = NextResponse.json(
      { authenticated: false },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      ...expiredSessionCookieOptions(),
    });
    return response;
  }

  emitLegacyUsage({ compatibilityId: "LEGACY-COOKIE-CONTRACT", variant: "v1", outcome: "accepted" });

  return Response.json(
    {
      authenticated: true,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    { headers: rateLimitHeaders(apiLimit) },
  );
}
