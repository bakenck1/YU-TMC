import { NextResponse } from "next/server";
import { ApplicationError } from "@/lib/domain/application-error";
import { defaultPathForRole } from "@/lib/security/authorization";
import { createSessionToken, sessionFromRequest, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/security/session";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { requirePhoneSetupUser } from "@/lib/server/security/request-user";
import { verifyWhatsAppPhoneForSave } from "@/lib/server/whatsapp-user-phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const actor = await requirePhoneSetupUser(request);
    if (!actor.whatsappPhoneRequired) throw new ApplicationError("conflict", "whatsapp_phone_already_set");
    const body = await readLimitedJson(request);
    if (!body || typeof body !== "object" || !("phone" in body) || typeof body.phone !== "string" || body.phone.length > 32) {
      throw new ApplicationError("validation", "invalid_phone");
    }
    const checked = await verifyWhatsAppPhoneForSave(body.phone);
    if (checked.warning) throw new ApplicationError("unavailable", "whatsapp_check_unavailable");
    if (!checked.phone) throw new ApplicationError("validation", "invalid_phone");
    const session = sessionFromRequest(request)!;
    const ttl = Math.max(1, session.exp - Math.floor(Date.now() / 1000));
    const user = await getApplicationServices().users.saveOwnWhatsAppPhone(actor, checked.phone);
    const response = NextResponse.json({ ok: true, redirectTo: defaultPathForRole(user.role) }, { headers });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: createSessionToken(user, ttl, user.sessionVersion),
      ...sessionCookieOptions({ maxAge: ttl }),
    });
    return response;
  } catch (error) {
    return applicationErrorResponse(error instanceof SyntaxError ? new ApplicationError("validation", "invalid_request") : error, headers);
  }
}
