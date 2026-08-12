import { NextResponse } from "next/server";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { getApplicationServices } from "@/lib/server/application";
import {
  clearFailedLogins,
  consumeLoginEmailLimit,
  consumeLoginIpLimit,
  normalizeEmail,
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
  sessionCookieOptions,
} from "@/lib/security/session";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";
import {
  assertLoginJsonRequest,
  readLoginJsonRequest,
} from "@/lib/security/login-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  try {
    requireSameOriginMutation(request);
  } catch (error) {
    return applicationErrorResponse(error, rateLimitHeaders(apiLimit));
  }

  const ipLimit = await consumeLoginIpLimit(request);
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit, "too_many_login_attempts");

  try {
    assertLoginJsonRequest(request);
  } catch (error) {
    return applicationErrorResponse(error, rateLimitHeaders(apiLimit));
  }

  let body: unknown;
  try {
    body = await readLoginJsonRequest(request);
  } catch (error) {
    if (error instanceof Error && error.name !== "SyntaxError") {
      return applicationErrorResponse(error, rateLimitHeaders(apiLimit));
    }
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

  const emailLimit = await consumeLoginEmailLimit(email);
  if (!emailLimit.allowed) {
    return rateLimitedResponse(emailLimit, "too_many_login_attempts");
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

  await clearFailedLogins(email);
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
    value: createSessionToken(user, ttlSeconds, authentication.sessionVersion),
    ...sessionCookieOptions(rememberMe ? { maxAge: ttlSeconds } : undefined),
  });
  return response;
}
