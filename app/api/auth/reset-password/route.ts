import { updatePasswordCredential } from "@/lib/security/credentials";
import {
  clearFailedLogins,
  normalizeEmail,
} from "@/lib/security/login-protection";
import {
  consumePasswordResetConfirmationLimit,
  verifyAndConsumePasswordResetCode,
} from "@/lib/security/password-reset";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const confirmationLimit = consumePasswordResetConfirmationLimit(request);
  if (!confirmationLimit.allowed) {
    return rateLimitedResponse(confirmationLimit, "too_many_reset_attempts");
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
    email?: unknown;
    code?: unknown;
    password?: unknown;
  };
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return Response.json(
      { error: "invalid_reset_code" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }
  if (password.length < 12 || password.length > 128) {
    return Response.json(
      { error: "invalid_new_password" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }
  if (!verifyAndConsumePasswordResetCode(email, code)) {
    return Response.json(
      { error: "invalid_reset_code" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let updated: boolean;
  try {
    updated = await updatePasswordCredential(email, password);
  } catch {
    updated = false;
  }
  if (!updated) {
    return Response.json(
      { error: "password_reset_failed" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  clearFailedLogins(email);
  return Response.json(
    { updated: true },
    { headers: rateLimitHeaders(apiLimit) },
  );
}
