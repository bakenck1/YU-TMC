import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getApplicationServices } from "@/lib/server/application";
import {
  canAccessPath,
  defaultPathForRole,
  isSafeReturnPath,
} from "@/lib/security/authorization";
import {
  exchangeGoogleAuthorizationCode,
  googleSsoConfig,
  GOOGLE_SSO_COOKIE_PATH,
  GOOGLE_SSO_TRANSACTION_COOKIE,
  verifyGoogleIdToken,
  verifyGoogleSsoTransactionToken,
} from "@/lib/security/google-sso";
import {
  createSessionToken,
  sessionCookieOptions,
  isSessionConfigured,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/security/session";
import {
  consumeApiRateLimit,
  rateLimitedResponse,
} from "@/lib/security/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiLimit = consumeApiRateLimit(request);
  if (!apiLimit.allowed) return rateLimitedResponse(apiLimit);

  const config = googleSsoConfig();
  if (!config || !isSessionConfigured()) {
    return finish(request, null, null, "google_not_configured");
  }

  const state = request.nextUrl.searchParams.get("state");
  const transactionToken = request.cookies.get(
    GOOGLE_SSO_TRANSACTION_COOKIE,
  )?.value;
  const transaction = transactionToken
    ? verifyGoogleSsoTransactionToken(transactionToken)
    : null;
  const validState =
    state !== null &&
    transaction !== null &&
    sameValue(state, transaction.state);

  const error = request.nextUrl.searchParams.get("error");
  if (error && validState) {
    return finish(
      request,
      config.redirectUri,
      null,
      error === "access_denied" ? "google_access_denied" : "google_failed",
    );
  }
  if (error) {
    return finish(request, config.redirectUri, null, "google_invalid_response");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (
    !code ||
    code.length > 4096 ||
    !validState
  ) {
    return finish(request, config.redirectUri, null, "google_invalid_response");
  }

  try {
    if (!transaction) {
      return finish(request, config.redirectUri, null, "google_invalid_response");
    }
    const idToken = await exchangeGoogleAuthorizationCode(
      config,
      code,
      transaction.codeVerifier,
    );
    const identity = await verifyGoogleIdToken(idToken, {
      clientId: config.clientId,
      hostedDomain: config.hostedDomain,
      nonce: transaction.nonce,
    });
    const authentication =
      await getApplicationServices().users.authenticateGoogleIdentity({
        subject: identity.subject,
        email: identity.email,
        name: identity.name,
      });
    if (authentication.status === "invalid") {
      return finish(
        request,
        config.redirectUri,
        null,
        "google_account_not_provisioned",
      );
    }
    if (authentication.status === "blocked") {
      return finish(request, config.redirectUri, null, "google_account_blocked");
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
    return finish(request, config.redirectUri, null, "google_failed");
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
    name: GOOGLE_SSO_TRANSACTION_COOKIE,
    value: "",
    httpOnly: true,
    secure: configuredOrigin
      ? new URL(configuredOrigin).protocol === "https:"
      : request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: GOOGLE_SSO_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}
