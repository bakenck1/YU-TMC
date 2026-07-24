import { NextResponse } from "next/server";
import {
  initializeAdminCredential,
  isPasswordLoginConfigured,
} from "@/lib/security/credentials";
import { normalizeEmail } from "@/lib/security/login-protection";
import { consumeRegistrationLimit } from "@/lib/security/registration-protection";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import {
  createSessionToken,
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

  const registrationLimit = consumeRegistrationLimit(request);
  if (!registrationLimit.allowed) {
    return rateLimitedResponse(registrationLimit, "too_many_registration_attempts");
  }

  if (await isPasswordLoginConfigured()) {
    return Response.json(
      { error: "registration_closed" },
      { status: 409, headers: rateLimitHeaders(apiLimit) },
    );
  }

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
    !validEmail(email) ||
    password.length < 12 ||
    password.length > 128
  ) {
    return Response.json(
      { error: "invalid_registration_data" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const user = await initializeAdminCredential({
    email,
    name: `${firstName} ${lastName}`,
    password,
  });
  if (!user) {
    return Response.json(
      { error: "registration_closed" },
      { status: 409, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const response = NextResponse.json(
    { registered: true, user },
    { status: 201, headers: rateLimitHeaders(apiLimit) },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(user, SESSION_TTL_SECONDS),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  return response;
}
