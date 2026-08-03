import { after } from "next/server";
import { getApplicationServices } from "@/lib/server/application";
import { normalizeEmail } from "@/lib/security/login-protection";
import {
  consumePasswordResetRequestLimits,
  commitPasswordResetCode,
  createPasswordResetUrl,
  createPasswordResetCode,
  revokePasswordResetCode,
} from "@/lib/security/password-reset";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";
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

  try {
    requireSameOriginMutation(request);
  } catch {
    return Response.json(
      { error: "cross_site_request_blocked" },
      { status: 403, headers: rateLimitHeaders(apiLimit) },
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
  const publicOrigin = process.env.AUTH_PASSWORD_RESET_PUBLIC_ORIGIN?.trim();
  let configured: boolean;
  try {
    configured = await getApplicationServices().users.isConfigured();
    if (publicOrigin) {
      createPasswordResetUrl(publicOrigin, "configuration-check@example.invalid");
    }
  } catch {
    configured = false;
  }
  if (!configured || !webhookUrl || !publicOrigin) {
    return Response.json(
      { error: "password_reset_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }

  let user;
  try {
    user =
      await getApplicationServices().users.findPasswordResetRecipient(email);
  } catch {
    return Response.json(
      { error: "password_reset_not_configured" },
      { status: 503, headers: rateLimitHeaders(apiLimit) },
    );
  }
  after(() => {
    if (!user) return;
    const resetUrl = createPasswordResetUrl(publicOrigin, email);
    return deliverPasswordReset({
      webhookUrl,
      email,
      name: user.name,
      resetUrl,
    });
  });

  return Response.json(
    { accepted: true },
    { status: 202, headers: rateLimitHeaders(apiLimit) },
  );
}

async function deliverPasswordReset(input: {
  webhookUrl: string;
  email: string;
  name: string;
  resetUrl: string;
}) {
  const code = createPasswordResetCode(input.email);
  try {
    const webhookResponse = await fetch(input.webhookUrl, {
      method: "POST",
      redirect: "error",
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
        email: input.email,
        name: input.name,
        code,
        resetUrl: input.resetUrl,
        expiresInMinutes: 15,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!webhookResponse.ok) throw new Error("password_reset_delivery_failed");
    commitPasswordResetCode(input.email, code);
  } catch (error) {
    revokePasswordResetCode(input.email, code);
    console.error("Password-reset delivery failed", error);
  }
}
