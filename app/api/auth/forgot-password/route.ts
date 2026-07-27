import {
  getConfiguredUser,
  isPasswordLoginConfigured,
} from "@/lib/security/credentials";
import { normalizeEmail } from "@/lib/security/login-protection";
import {
  consumePasswordResetRequestLimits,
  commitPasswordResetCode,
  createPasswordResetCode,
  revokePasswordResetCode,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const email = normalizeEmail(
    body && typeof body === "object" && "email" in body
      ? String((body as { email: unknown }).email)
      : "",
  );
  if (!validEmail(email)) {
    return Response.json(
      { error: "invalid_email" },
      { status: 400, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const resetLimit = consumePasswordResetRequestLimits(request, email);
  if (!resetLimit.allowed) {
    return rateLimitedResponse(resetLimit, "too_many_reset_requests");
  }

  const webhookUrl = process.env.AUTH_PASSWORD_RESET_WEBHOOK_URL?.trim();
  if (!(await isPasswordLoginConfigured()) || !webhookUrl) {
    return Response.json(
      { error: "password_reset_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  const user = await getConfiguredUser();
  if (user && user.email === email) {
    const code = createPasswordResetCode(email);
    const resetUrl = new URL("/reset-password", request.url);
    resetUrl.searchParams.set("email", email);

    try {
      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET
            ? {
                Authorization: `Bearer ${process.env.AUTH_PASSWORD_RESET_WEBHOOK_SECRET}`,
              }
            : {}),
        },
        body: JSON.stringify({
          type: "password_reset",
          email,
          name: user.name,
          code,
          resetUrl: resetUrl.toString(),
          expiresInMinutes: 15,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!webhookResponse.ok) throw new Error("password_reset_delivery_failed");
      commitPasswordResetCode(email, code);
    } catch (error) {
      revokePasswordResetCode(email, code);
      console.error("Password-reset delivery failed", error);
    }
  }

  return Response.json(
    { accepted: true },
    { status: 202, headers: rateLimitHeaders(apiLimit) },
  );
}
