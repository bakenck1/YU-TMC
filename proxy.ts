import { NextRequest, NextResponse } from "next/server";
import {
  isSafeReturnPath,
} from "@/lib/security/authorization";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/security/session";

const PUBLIC_PAGES = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

function loginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (isSafeReturnPath(returnTo)) loginUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(loginUrl);
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySessionToken(token) : null;
  const isPublicPage = PUBLIC_PAGES.has(pathname);

  if (!session && !isPublicPage) {
    const response = loginRedirect(request);
    if (token) response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  const response = NextResponse.next();
  if (token && !session) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
