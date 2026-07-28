import { NextRequest, NextResponse } from "next/server";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/security/session";
import { getApplicationServices } from "@/lib/server/application";

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

  let user;
  try {
    user = await getApplicationServices().users.resolveSessionSubject(
      session.sub,
    );
  } catch {
    return Response.json(
      { error: "authentication_unavailable" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (!user) {
    const response = NextResponse.json(
      { authenticated: false },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    return response;
  }

  return Response.json(
    { authenticated: true, user },
    { headers: rateLimitHeaders(apiLimit) },
  );
}
