import { NextResponse } from "next/server";
import { getApplicationServices } from "@/lib/server/application";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  initializeAdminCredential,
  isPasswordLoginConfigured,
} from "@/lib/security/credentials";
import { normalizeEmail } from "@/lib/security/login-protection";
import {
  consumeRegistrationLimit,
  isAuthorizedBootstrapRequest,
} from "@/lib/security/registration-protection";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validName(value: string) {
  return value.length >= 2 && value.length <= 60;
}

export async function POST(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  if (!isAuthorizedBootstrapRequest(request)) {
    return Response.json(
      { error: "registration_not_authorized" },
      { status: 403, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const registrationLimit = await consumeRegistrationLimit(request);
  if (!registrationLimit.allowed) {
    return rateLimitedResponse(registrationLimit, "too_many_registration_attempts");
  }

  let configured: boolean;
  try {
    configured = await isPasswordLoginConfigured();
  } catch {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }
  if (configured) {
    return Response.json(
      { error: "registration_closed" },
      { status: 409, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let body: unknown;
  try {
    body = await readLimitedJson(request, 8 * 1024);
  } catch (error) {
    return applicationErrorResponse(error, rateLimitHeaders(apiLimit));
  }

  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const input = body as {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    password?: unknown;
  };
  const firstName =
    typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName =
    typeof input.lastName === "string" ? input.lastName.trim() : "";
  const email = normalizeEmail(
    typeof input.email === "string" ? input.email : "",
  );
  const password = typeof input.password === "string" ? input.password : "";

  if (
    !validName(firstName) ||
    !validName(lastName) ||
    `${firstName} ${lastName}`.length > 120 ||
    !validEmail(email) ||
    password.length < 12 ||
    password.length > 128
  ) {
    return Response.json(
      { error: "invalid_registration_data" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let user;
  try {
    user = await initializeAdminCredential({
      email,
      name: `${firstName} ${lastName}`,
      password,
    });
  } catch {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }
  if (!user) {
    return Response.json(
      { error: "registration_closed" },
      { status: 409, headers: rateLimitHeaders(apiLimit) },
    );
  }
  const account = await getApplicationServices().users.resolveCurrentAccount(
    user.email,
  );
  if (!account) {
    return Response.json(
      { error: "authentication_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const response = NextResponse.json(
    { registered: true, user },
    { status: 201, headers: rateLimitHeaders(apiLimit) },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(user, SESSION_TTL_SECONDS, account.sessionVersion),
    ...sessionCookieOptions(),
  });
  return response;
}
