import { NextResponse } from "next/server";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    requireSameOriginMutation(request);
  } catch (error) {
    return applicationErrorResponse(error, headers);
  }

  const response = NextResponse.json(
    { authenticated: false },
    { headers },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
