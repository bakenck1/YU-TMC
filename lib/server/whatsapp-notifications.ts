import "server-only";

import { getDatabasePool } from "@/lib/db/client";
import { checkWhatsApp, normalizeWhatsAppPhone, sendWhatsApp, WhatsAppError, whatsappConfigured, whatsappSession } from "@/lib/server/whatsapp-gateway";

export interface WhatsAppNotification {
  ticket: string;
  kind: string;
  recipientId: string;
  message?: string;
  template?: string;
  data?: Record<string, string>;
}

/** Call after the domain transaction commits. Delivery must never reject the UI action. */
export async function notifyWhatsApp(input: WhatsAppNotification): Promise<void> {
  if (!whatsappConfigured()) return;
  try {
    const recipient = await getDatabasePool().query<{ phone: string | null }>(
      `select phone from "yu_inventory"."users"
       where id = $1 and is_active = true and deleted_at is null`,
      [input.recipientId],
    );
    if (!recipient.rows[0]?.phone) return;
    let phone: string;
    try { phone = normalizeWhatsAppPhone(recipient.rows[0].phone); } catch { return; }
    if (!(await reserveWhatsAppNotification(input))) return;
    if (!(await checkWhatsApp(phone))) return;
    await sendWhatsApp({ to: phone, message: input.message, template: input.template, data: input.data });
    await getDatabasePool().query(
      `update "yu_inventory"."whatsapp_delivery_attempts" set sent_at = now()
       where session = $1 and ticket = $2 and kind = $3 and recipient_id = $4`,
      [whatsappSession(), input.ticket, input.kind, input.recipientId],
    );
  } catch (error) {
    console.warn("WhatsApp notification failed", {
      ticket: input.ticket,
      kind: input.kind,
      code: error instanceof WhatsAppError ? error.code : "WA_ERROR",
    });
  }
}

/** Atomic, persistent 24-hour cooldown scoped to the session and recipient. */
export async function reserveWhatsAppNotification(input: Pick<WhatsAppNotification, "ticket" | "kind" | "recipientId">): Promise<boolean> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const session = whatsappSession();
    await client.query(
      `insert into "yu_inventory"."whatsapp_session_limits" (session) values ($1)
       on conflict (session) do nothing`, [session],
    );
    const paused = await client.query<{ paused: boolean }>(
      `select coalesce(retry_after_at > now(), false) as paused
       from "yu_inventory"."whatsapp_session_limits" where session = $1 for update`, [session],
    );
    if (paused.rows[0]?.paused) {
      await client.query("commit");
      return false;
    }
    const claimed = await client.query(
      `insert into "yu_inventory"."whatsapp_delivery_attempts" (session, ticket, kind, recipient_id, attempted_at)
       values ($1, $2, $3, $4, now())
       on conflict (session, ticket, kind, recipient_id) do update set attempted_at = now(), sent_at = null
       where "whatsapp_delivery_attempts".attempted_at <= now() - interval '24 hours'
       returning ticket`, [session, input.ticket, input.kind, input.recipientId],
    );
    await client.query("commit");
    return claimed.rowCount === 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
