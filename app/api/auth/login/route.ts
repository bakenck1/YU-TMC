import { NextResponse } from "next/server";
import { getApplicationServices } from "@/lib/server/application";
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
  REMEMBERED_SESSION_TTL_SECONDS,
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

  const credentials = body as {
    email?: unknown;
    password?: unknown;
    rememberMe?: unknown;
  };
  if (typeof credentials.email !== "string" || typeof credentials.password !== "string") {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const email = normalizeEmail(credentials.email);
  const password = credentials.password;
  const rememberMe = credentials.rememberMe === true;
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

  let configured: boolean;
  try {
    configured = await getApplicationServices().users.isConfigured();
  } catch {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (!configured || !isSessionConfigured()) {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let authentication: Awaited<
    ReturnType<ReturnType<typeof getApplicationServices>["users"]["authenticate"]>
  >;
  try {
    authentication = await getApplicationServices().users.authenticate(
      email,
      password,
    );
  } catch {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (authentication.status === "invalid") {
    const failedAttempt = recordFailedLogin(email);
    if (!failedAttempt.allowed) {
      return rateLimitedResponse(failedAttempt, "too_many_login_attempts");
    }

    return Response.json(
      { error: "invalid_credentials" },
      { status: 401, headers: rateLimitHeaders(apiLimit) },
    );
  }

  if (authentication.status === "blocked") {
    return Response.json(
      { error: "user_blocked" },
      { status: 403, headers: rateLimitHeaders(apiLimit) },
    );
  }

  clearFailedLogins(email);
  const user = authentication.user;
  const ttlSeconds = rememberMe
    ? REMEMBERED_SESSION_TTL_SECONDS
    : SESSION_TTL_SECONDS;
  const response = NextResponse.json(
    { authenticated: true, user },
    { headers: rateLimitHeaders(apiLimit) },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(user, ttlSeconds),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    ...(rememberMe ? { maxAge: ttlSeconds } : {}),
  });
  return response;
}
