import { NextResponse } from "next/server";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";
import {
  expiredSessionCookieOptions,
  sessionFromRequest,
  SESSION_COOKIE_NAME,
} from "@/lib/security/session";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { getApplicationServices } from "@/lib/server/application";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    requireSameOriginMutation(request);
  } catch (error) {
    return applicationErrorResponse(error, headers);
  }

  const session = sessionFromRequest(request);
  if (session) {
    try {
      await getApplicationServices().users.revokeSessions(session.sub);
    } catch {
      // Cookie removal must still succeed if the identity store is unavailable.
    }
  }

  const response = NextResponse.json(
    { authenticated: false },
    { headers },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...expiredSessionCookieOptions(),
  });
  return response;
}
