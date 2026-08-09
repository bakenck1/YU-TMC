import { updatePasswordCredential } from "@/lib/security/credentials";
import {
  clearFailedLogins,
  normalizeEmail,
} from "@/lib/security/login-protection";
import {
  consumePasswordResetConfirmationLimit,
  restoreConsumedPasswordResetCode,
  verifyAndConsumePasswordResetCode,
} from "@/lib/security/password-reset";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
} from "@/lib/security/rate-limiter";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

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
  } catch {
    return Response.json(
      { error: "cross_site_request_blocked" },
      { status: 403, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const confirmationLimit = await consumePasswordResetConfirmationLimit(request);
  if (!confirmationLimit.allowed) {
    return rateLimitedResponse(confirmationLimit, "too_many_reset_attempts");
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
  if (!(await verifyAndConsumePasswordResetCode(email, code))) {
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
    try {
      await restoreConsumedPasswordResetCode(email, code);
    } catch {
      // The credential update already failed. Do not mask the safe generic
      // response if recovery storage is unavailable too.
    }
    return Response.json(
      { error: "password_reset_failed" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  await clearFailedLogins(email);
  return Response.json(
    { updated: true },
    { headers: rateLimitHeaders(apiLimit) },
  );
}
