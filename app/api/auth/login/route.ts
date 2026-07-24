import { NextResponse } from "next/server";
import {
  isPasswordLoginConfigured,
  verifyPasswordCredentials,
} from "@/lib/security/credentials";
import {
  checkFailedLoginLimit,
  clearFailedLogins,
  consumeLoginIpLimit,
  normalizeEmail,
  recordFailedLogin,
} from "@/lib/security/login-protection";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  createSessionToken,
  isSessionConfigured,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const ipLimit = consumeLoginIpLimit(request);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit, "too_many_login_attempts");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const credentials = body as { email?: unknown; password?: unknown };
  if (typeof credentials.email !== "string" || typeof credentials.password !== "string") {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const email = normalizeEmail(credentials.email);
  const password = credentials.password;
  if (!validEmail(email) || password.length < 1 || password.length > 1024) {
    return Response.json(
      { error: "invalid_credentials" },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const emailLimit = checkFailedLoginLimit(email);
  if (!emailLimit.allowed) {
    return rateLimitedResponse(emailLimit, "too_many_login_attempts");
  }

  const authenticated = await verifyPasswordCredentials(email, password);
  if (!authenticated) {
    const failedAttempt = recordFailedLogin(email);
    if (!failedAttempt.allowed) {
      return rateLimitedResponse(failedAttempt, "too_many_login_attempts");
    }

    return Response.json(
      { error: "invalid_credentials" },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (!isPasswordLoginConfigured() || !isSessionConfigured()) {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  clearFailedLogins(email);
  const response = NextResponse.json(
    { authenticated: true },
    { headers: rateLimitHeaders(apiLimit) },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(email),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
