import { NextRequest, NextResponse } from "next/server";
import {
  isSafeReturnPath,
} from "@/lib/security/authorization";
import { SESSION_COOKIE_NAME } from "@/lib/security/session-constants";
import { configuredPublicOrigin } from "@/lib/security/public-origin";

const PUBLIC_PAGES = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

function loginRedirect(request: NextRequest) {
  const loginUrl = new URL(
    "/login",
    configuredPublicOrigin() ?? request.nextUrl.origin,
  );
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (isSafeReturnPath(returnTo)) loginUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(loginUrl);
}

function requestContentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    ...(process.env.NODE_ENV === "production"
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
}

function nonceResponse(request: NextRequest, nonce: string, policy: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = requestContentSecurityPolicy(nonce);
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isPublicPage = PUBLIC_PAGES.has(pathname);

  if (!token && !isPublicPage) {
    const response = loginRedirect(request);
    response.headers.set("Content-Security-Policy", policy);
    return response;
  }

  return nonceResponse(request, nonce, policy);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
