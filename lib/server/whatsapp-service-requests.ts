import "server-only";

import { getDatabasePool } from "@/lib/db/client";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import { notifyWhatsApp } from "@/lib/server/whatsapp-notifications";
import { whatsappConfigured } from "@/lib/server/whatsapp-gateway";

export async function notifyServiceRequestByWhatsApp(request: ServiceRequestDto): Promise<void> {
  if (!whatsappConfigured() || request.source !== "internal") return;
  try {
    const result = await getDatabasePool().query<{ author_id: string }>(
      `select author_id from "yu_inventory"."service_requests" where id = $1 and source = 'internal'`,
      [request.id],
    );
    const recipientId = result.rows[0]?.author_id;
    if (!recipientId) return;
    await notifyWhatsApp({
      ticket: request.id,
      kind: "generic_status",
      recipientId,
      template: "generic_status",
      data: {
        title: "YU Inventory",
        ticket: request.id,
        status: request.status === "new" ? "Создана" : request.status === "in_progress" ? "В работе" : "Завершена",
        extra: "Подробности в личном кабинете",
      },
    });
  } catch {
    console.warn("WhatsApp service request notification failed", { requestId: request.id, code: "WA_ERROR" });
  }
}
