import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getApplicationServices } from "@/lib/server/application";
import {
  canAccessPath,
  defaultPathForRole,
  isSafeReturnPath,
} from "@/lib/security/authorization";
import {
  exchangeYessenovAuthorizationCode,
  verifyYessenovIdToken,
  verifyYessenovSsoTransactionToken,
  YESSENOV_SSO_COOKIE_PATH,
  YESSENOV_SSO_TRANSACTION_COOKIE,
  yessenovSsoConfig,
} from "@/lib/security/yessenov-sso";
import {
  createSessionToken,
  isSessionConfigured,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "@/lib/security/session";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
} from "@/lib/security/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiLimit = await consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const config = yessenovSsoConfig();
  if (!config || !isSessionConfigured()) {
    return finish(request, null, null, "yessenov_not_configured");
  }
  const state = request.nextUrl.searchParams.get("state");
  const transactionToken = request.cookies.get(
    YESSENOV_SSO_TRANSACTION_COOKIE,
  )?.value;
  const transaction = transactionToken
    ? verifyYessenovSsoTransactionToken(transactionToken)
    : null;
  const validState =
    state !== null && transaction !== null && sameValue(state, transaction.state);
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError && validState) {
    return finish(
      request,
      config.redirectUri,
      null,
      providerError === "access_denied"
        ? "yessenov_access_denied"
        : "yessenov_failed",
    );
  }
  if (providerError) {
    return finish(request, config.redirectUri, null, "yessenov_invalid_response");
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096 || !validState || !transaction) {
    return finish(request, config.redirectUri, null, "yessenov_invalid_response");
  }

  try {
    const idToken = await exchangeYessenovAuthorizationCode(config, code);
    const identity = await verifyYessenovIdToken(idToken, {
      clientId: config.clientId,
      nonce: transaction.nonce,
    });
    const authentication =
      await getApplicationServices().users.authenticateYessenovIdentity(identity);
    if (authentication.status === "invalid") {
      return finish(request, config.redirectUri, null, "yessenov_account_invalid");
    }
    if (authentication.status === "blocked") {
      return finish(request, config.redirectUri, null, "yessenov_account_blocked");
    }
    const returnTo = transaction.returnTo;
    const destination =
      isSafeReturnPath(returnTo) &&
      canAccessPath(authentication.user.role, returnTo!)
        ? returnTo!
        : defaultPathForRole(authentication.user.role);
    const response = finish(request, config.redirectUri, destination);
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: createSessionToken(
        authentication.user,
        SESSION_TTL_SECONDS,
        authentication.sessionVersion,
      ),
      ...sessionCookieOptions({
        maxAge: SESSION_TTL_SECONDS,
        sameSite: "lax",
      }),
    });
    return response;
  } catch {
    return finish(request, config.redirectUri, null, "yessenov_failed");
  }
}

function sameValue(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function finish(
  request: NextRequest,
  configuredRedirectUri: string | null,
  destination: string | null,
  error?: string,
) {
  const configuredOrigin = configuredRedirectUri
    ? new URL(configuredRedirectUri).origin
    : null;
  const url = new URL(
    destination ?? "/login",
    configuredOrigin ?? "https://relative.invalid",
  );
  if (error) url.searchParams.set("error", error);
  const response = configuredOrigin
    ? NextResponse.redirect(url)
    : new NextResponse(null, {
        status: 307,
        headers: { location: `${url.pathname}${url.search}${url.hash}` },
      });
  response.headers.set("cache-control", "no-store");
  response.cookies.set({
    name: YESSENOV_SSO_TRANSACTION_COOKIE,
    value: "",
    httpOnly: true,
    secure: configuredOrigin
      ? new URL(configuredOrigin).protocol === "https:"
      : request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: YESSENOV_SSO_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}
