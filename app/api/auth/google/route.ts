import { NextResponse } from "next/server";
import {
  createGoogleAuthorizationRequest,
  createGoogleSsoTransactionToken,
  googleSsoConfig,
  GOOGLE_SSO_COOKIE_PATH,
  GOOGLE_SSO_TRANSACTION_COOKIE,
  GOOGLE_SSO_TRANSACTION_TTL_SECONDS,
} from "@/lib/security/google-sso";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
} from "@/lib/security/rate-limiter";
import { isSessionConfigured } from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const apiLimit = await consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const config = googleSsoConfig();
  if (!config || !isSessionConfigured()) {
    return loginRedirect("google_not_configured");
  }

  const requestUrl = new URL(request.url);
  const transaction = createGoogleAuthorizationRequest(
    config,
    requestUrl.searchParams.get("returnTo"),
  );
  const response = NextResponse.redirect(transaction.url);
  response.headers.set("cache-control", "no-store");
  const cookieOptions = {
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    sameSite: "lax" as const,
    path: GOOGLE_SSO_COOKIE_PATH,
    maxAge: GOOGLE_SSO_TRANSACTION_TTL_SECONDS,
  };
  response.cookies.set({
    name: GOOGLE_SSO_TRANSACTION_COOKIE,
    value: createGoogleSsoTransactionToken(transaction),
    ...cookieOptions,
  });
  return response;
}

function loginRedirect(error: string) {
  const search = new URLSearchParams({ error });
  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": "no-store",
      location: `/login?${search}`,
    },
  });
}
