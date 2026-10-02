import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import {
  checkWhatsApp,
  normalizeWhatsAppPhone,
  whatsappConfigured,
  whatsappSession,
  WhatsAppError,
} from "@/lib/server/whatsapp-gateway";

export async function verifyWhatsAppPhoneForSave(
  phone: string | null | undefined,
): Promise<{ phone: string | null | undefined; warning: boolean }> {
  if (phone === undefined) return { phone, warning: false };
  if (!phone?.trim() || phone.trim() === "—") {
    return { phone: null, warning: false };
  }
  let normalized: string;
  try {
    normalized = normalizeWhatsAppPhone(phone);
  } catch {
    throw new ApplicationError("validation", "invalid_phone");
  }
  if (!whatsappConfigured()) {
    return { phone: undefined, warning: true };
  }
  try {
    if (!(await checkWhatsApp(normalized))) {
      throw new ApplicationError("validation", "whatsapp_not_registered");
    }
    return { phone: normalized, warning: false };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    console.warn("WhatsApp phone verification unavailable", {
      code: error instanceof WhatsAppError ? error.code : "WA_ERROR",
    });
    // Keep the user mutation available, but do not persist an unverified number.
    return { phone: undefined, warning: true };
  }
}

// Imported directory/SSO claims are optional profile data. Rejecting an
// unregistered claim must not block authentication or personnel synchronization.
const importCheckPausedUntil = new Map<string, number>();

export async function verifyImportedWhatsAppPhone(
  phone: string | null | undefined,
  existingPhone?: string | null,
): Promise<string | null | undefined> {
  // Missing directory claims must not erase a number supplied by the user.
  if (!phone?.trim() || phone.trim() === "—") return undefined;
  // Only reuse canonical persisted numbers. Legacy formatted values must pass
  // an initial gateway check before being rewritten in canonical form.
  if (existingPhone && /^7\d{10}$/.test(existingPhone) && phone?.trim()) {
    try {
      if (normalizeWhatsAppPhone(phone) === existingPhone) return existingPhone;
    } catch {
      return undefined;
    }
  }
  const session = `${process.env.WA_GATEWAY_URL ?? ""}:${whatsappSession()}`;
  if (phone?.trim() && (importCheckPausedUntil.get(session) ?? 0) > Date.now()) {
    return undefined;
  }
  try {
    const result = await verifyWhatsAppPhoneForSave(phone);
    // Do not spend a separate timeout on every employee when a directory
    // refresh encounters an unavailable gateway; no immediate retry is queued.
    if (result.warning) importCheckPausedUntil.set(session, Date.now() + 30_000);
    else importCheckPausedUntil.delete(session);
    return result.phone;
  } catch (error) {
    if (error instanceof ApplicationError) {
      console.warn("WhatsApp imported phone skipped", { code: error.publicCode });
      return undefined;
    }
    throw error;
  }
}
