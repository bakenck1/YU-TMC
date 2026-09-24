import "server-only";

import { getDatabasePool } from "@/lib/db/client";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import {
  checkWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsApp,
  WhatsAppError,
  whatsappConfigured,
  whatsappSession,
} from "@/lib/server/whatsapp-gateway";

const TEMPLATE = "generic_status";
const COOLDOWN_MINUTES = 45;

type RecipientRow = { phone: string | null };

export async function notifyServiceRequestByWhatsApp(request: ServiceRequestDto): Promise<void> {
  if (!whatsappConfigured() || request.source !== "internal") return;
  try {
    const recipient = await getDatabasePool().query<RecipientRow>(
      `select author.phone
         from "yu_inventory"."service_requests" service_request
         join "yu_inventory"."users" author on author.id = service_request.author_id
        where service_request.id = $1 and service_request.source = 'internal'
          and author.is_active = true and author.deleted_at is null`,
      [request.id],
    );
    const rawPhone = recipient.rows[0]?.phone;
    if (!rawPhone) return;
    let phone: string;
    try { phone = normalizeWhatsAppPhone(rawPhone); } catch { return; }
    if (!(await reserveAttempt(request.id))) return;
    if (!(await checkWhatsApp(phone))) return;
    await sendWhatsApp({
      to: phone,
      template: TEMPLATE,
      data: {
        title: "YU Inventory",
        ticket: request.id,
        status: request.status === "new" ? "Создана" : request.status === "in_progress" ? "В работе" : "Завершена",
        extra: "Подробности в личном кабинете",
      },
    });
    await getDatabasePool().query(
      `update "yu_inventory"."whatsapp_notification_attempts"
          set sent_at = now()
        where request_id = $1 and template = $2`,
      [request.id, TEMPLATE],
    );
  } catch (error) {
    if (error instanceof WhatsAppError && error.code === "WA_RATE") {
      await pauseSession(error.retryAfterMs).catch(() => undefined);
    }
    console.warn("WhatsApp service request notification failed", {
      requestId: request.id,
      code: error instanceof WhatsAppError ? error.code : "WA_ERROR",
    });
  }
}

async function reserveAttempt(requestId: string): Promise<boolean> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const session = whatsappSession();
    await client.query(
      `insert into "yu_inventory"."whatsapp_session_limits" (session) values ($1)
       on conflict (session) do nothing`,
      [session],
    );
    const limit = await client.query<{ retry_after_at: Date | null }>(
      `select retry_after_at from "yu_inventory"."whatsapp_session_limits"
        where session = $1 for update`,
      [session],
    );
    if (limit.rows[0]?.retry_after_at && limit.rows[0].retry_after_at > new Date()) {
      await client.query("commit");
      return false;
    }
    const claimed = await client.query(
      `insert into "yu_inventory"."whatsapp_notification_attempts"
         (request_id, template, attempted_at)
       values ($1, $2, now())
       on conflict (request_id, template) do update
          set attempted_at = now(), sent_at = null
        where "whatsapp_notification_attempts".attempted_at <= now() - interval '${COOLDOWN_MINUTES} minutes'
       returning request_id`,
      [requestId, TEMPLATE],
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

async function pauseSession(retryAfterMs?: number): Promise<void> {
  const delay = Math.min(Math.max(retryAfterMs ?? 60 * 60_000, 1000), 24 * 60 * 60_000);
  await getDatabasePool().query(
    `insert into "yu_inventory"."whatsapp_session_limits" (session, retry_after_at)
     values ($1, $2)
     on conflict (session) do update
       set retry_after_at = greatest("whatsapp_session_limits".retry_after_at, excluded.retry_after_at)`,
    [whatsappSession(), new Date(Date.now() + delay)],
  );
}
