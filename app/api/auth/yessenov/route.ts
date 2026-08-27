import { NextResponse } from "next/server";

import {
  createYessenovAuthorizationRequest,
  createYessenovSsoTransactionToken,
  YESSENOV_SSO_COOKIE_PATH,
  YESSENOV_SSO_TRANSACTION_COOKIE,
  YESSENOV_SSO_TRANSACTION_TTL_SECONDS,
  yessenovSsoConfig,
} from "@/lib/security/yessenov-sso";
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

  const config = yessenovSsoConfig();
  if (!config || !isSessionConfigured()) {
    return loginRedirect("yessenov_not_configured");
  }
  const requestUrl = new URL(request.url);
  const transaction = createYessenovAuthorizationRequest(
    config,
    requestUrl.searchParams.get("returnTo"),
  );
  const response = NextResponse.redirect(transaction.url);
  response.headers.set("cache-control", "no-store");
  response.cookies.set({
    name: YESSENOV_SSO_TRANSACTION_COOKIE,
    value: createYessenovSsoTransactionToken(transaction),
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    sameSite: "lax",
    path: YESSENOV_SSO_COOKIE_PATH,
    maxAge: YESSENOV_SSO_TRANSACTION_TTL_SECONDS,
  });
  return response;
}

function loginRedirect(error: string) {
  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": "no-store",
      location: `/login?${new URLSearchParams({ error })}`,
    },
  });
}
