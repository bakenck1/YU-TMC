import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import {
  checkWhatsApp,
  normalizeWhatsAppPhone,
  whatsappConfigured,
} from "@/lib/server/whatsapp-gateway";

export async function verifyWhatsAppPhoneForSave(
  phone: string | null | undefined,
): Promise<{ phone: string | null | undefined; warning: boolean }> {
  if (!phone?.trim() || phone.trim() === "—" || !whatsappConfigured()) {
    return { phone, warning: false };
  }
  let normalized: string;
  try {
    normalized = normalizeWhatsAppPhone(phone);
  } catch {
    throw new ApplicationError("validation", "invalid_phone");
  }
  try {
    if (!(await checkWhatsApp(normalized))) {
      throw new ApplicationError("validation", "whatsapp_not_registered");
    }
    return { phone: normalized, warning: false };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    // Keep the user mutation available, but do not persist an unverified number.
    return { phone: undefined, warning: true };
  }
}
