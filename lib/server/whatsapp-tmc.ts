import "server-only";

import { getDatabasePool } from "@/lib/db/client";
import type { TmcTransferRequestDto, TmcTransferRequestItemDto } from "@/lib/contracts/tmc-operations";
import { notifyWhatsApp, type WhatsAppNotification } from "@/lib/server/whatsapp-notifications";

type Sender = (notification: WhatsAppNotification) => Promise<void>;

function goods(items: TmcTransferRequestItemDto[]): string {
  const listed = items.slice(0, 8).map(({ item, requestedQuantity }) =>
    `«${item.name}» (инв. № ${item.inventoryNumber}${requestedQuantity != null ? `, ${requestedQuantity} шт.` : ""})`);
  if (items.length > listed.length) listed.push(`и ещё ${items.length - listed.length} позиций`);
  return listed.join(", ");
}

function isClaim(request: TmcTransferRequestDto): boolean {
  return request.items.length > 0 && request.items.every((item) =>
    item.currentResponsibleIdAtRequest === request.recipient.id);
}

export function tmcCreatedWhatsAppNotifications(request: TmcTransferRequestDto): WhatsAppNotification[] {
  if (request.status !== "pending") {
    return tmcDecisionWhatsAppNotifications(request, request.items.map((item) => item.item.id), true);
  }
  const action = isClaim(request) ? "на получение ТМЦ от вас" : "на передачу ТМЦ вам";
  return [
    {
      ticket: request.id, kind: "tmc_requested", recipientId: request.recipient.id,
      message: `Здравствуйте, ${request.recipient.fullName}! ${request.initiator.fullName} отправил(а) запрос ${action}: ${goods(request.items)}. Заявка № ${request.id}. Примите или отклоните запрос в разделе «Заявки ТМЦ» на сайте YU Inventory.`,
    },
    {
      ticket: request.id, kind: "tmc_submitted", recipientId: request.initiator.id,
      message: `Здравствуйте, ${request.initiator.fullName}! Вы отправили запрос ${action === "на получение ТМЦ от вас" ? "на получение ТМЦ" : "на передачу ТМЦ"} пользователю ${request.recipient.fullName}: ${goods(request.items)}. Заявка № ${request.id}. Ожидайте решения; статус доступен в разделе «Заявки ТМЦ» на сайте YU Inventory.`,
    },
  ];
}

/** Only the items in the committed command are considered, including partial decisions. */
export function tmcDecisionWhatsAppNotifications(request: TmcTransferRequestDto, decidedItemIds: string[], immediateAssignment = false): WhatsAppNotification[] {
  const selected = new Set(decidedItemIds.map((id) => id.toLowerCase()));
  const accepted = request.items.filter((item) => selected.has(item.item.id.toLowerCase()) && item.result === "accepted");
  const rejected = request.items.filter((item) => selected.has(item.item.id.toLowerCase()) && item.result === "rejected");
  const result: WhatsAppNotification[] = [];
  const claimer = isClaim(request);
  if (accepted.length) {
    if (!immediateAssignment) result.push({
      ticket: request.id, kind: "tmc_accepted", recipientId: request.initiator.id,
      message: `Здравствуйте, ${request.initiator.fullName}! ${request.isAdministrativeDecision ? "Администратор принял ваш запрос" : `${request.recipient.fullName} принял(а) ваш запрос`} по ТМЦ: ${goods(accepted)}. Заявка № ${request.id}. ${claimer ? "Вы назначены ответственным. Согласуйте получение ТМЦ с предыдущим ответственным." : "Передача подтверждена. Согласуйте передачу ТМЦ с новым ответственным."} Подробности — в разделе «Заявки ТМЦ» на сайте YU Inventory.`,
    });
    // For a claim, the acceptance notice already tells the initiator about responsibility.
    if (!claimer || immediateAssignment) result.push({
      ticket: request.id, kind: "responsibility_assigned", recipientId: claimer ? request.initiator.id : request.recipient.id,
      message: `Здравствуйте! Вы назначены ответственным за ТМЦ: ${goods(accepted)}. ${request.isAdministrativeDecision ? "Назначение выполнено администратором." : `Передача от ${request.initiator.fullName} подтверждена.`} Заявка № ${request.id}. Проверьте сведения в личном кабинете на сайте YU Inventory.`,
    });
  }
  if (rejected.length) result.push({
    ticket: request.id, kind: "tmc_rejected", recipientId: request.initiator.id,
    message: `Здравствуйте, ${request.initiator.fullName}! ${request.isAdministrativeDecision ? "Администратор отклонил ваш запрос" : `${request.recipient.fullName} отклонил(а) ваш запрос`} по ТМЦ: ${goods(rejected)}. Заявка № ${request.id}. Ответственный за эти ТМЦ не изменился. Подробности — в разделе «Заявки ТМЦ» на сайте YU Inventory.`,
  });
  return result;
}

async function deliver(notifications: WhatsAppNotification[], send: Sender): Promise<void> {
  for (const notification of notifications) {
    try { await send(notification); } catch { console.warn("WhatsApp TMC notification failed", { ticket: notification.ticket, kind: notification.kind }); }
  }
}

export async function notifyTmcCreatedByWhatsApp(request: TmcTransferRequestDto, send: Sender = notifyWhatsApp): Promise<void> {
  await deliver(tmcCreatedWhatsAppNotifications(request), send);
}

export async function notifyTmcDecisionByWhatsApp(request: TmcTransferRequestDto, decidedItemIds: string[], send: Sender = notifyWhatsApp): Promise<void> {
  await deliver(tmcDecisionWhatsAppNotifications(request, decidedItemIds), send);
}

export async function notifyResponsibilityAssignedByWhatsApp(input: {
  ticket: string; itemId: string; itemName?: string; inventoryNumber?: string; responsibleUserId: string;
}): Promise<void> {
  await notifyWhatsApp({
    ticket: input.ticket, kind: "responsibility_assigned", recipientId: input.responsibleUserId,
    message: `Здравствуйте! Вы назначены ответственным за ТМЦ «${input.itemName || input.itemId}»${input.inventoryNumber ? ` (инв. № ${input.inventoryNumber})` : ""}. Проверьте сведения в личном кабинете на сайте YU Inventory.`,
  });
}

export async function notifyCurrentResponsibilityByWhatsApp(itemId: string, responsibleUserId: string): Promise<void> {
  try {
    const result = await getDatabasePool().query<{ id: string; name: string; inventory_number: string }>(
      `select period.id, item.name, item.inventory_number
         from "yu_inventory"."responsibility_periods" period
         join "yu_inventory"."items" item on item.id = period.item_id
        where period.item_id = $1 and period.responsible_user_id = $2 and period.ended_at is null`,
      [itemId, responsibleUserId],
    );
    const period = result.rows[0];
    if (period) await notifyResponsibilityAssignedByWhatsApp({ ticket: period.id, itemId, responsibleUserId, itemName: period.name, inventoryNumber: period.inventory_number });
  } catch { console.warn("WhatsApp responsibility notification failed", { itemId }); }
}

/** Legacy endpoints return a participant-scoped DTO without recipient IDs. Read committed facts on the server. */
export async function notifyLegacyTransferByWhatsApp(transferId: string): Promise<void> {
  try {
    const result = await getDatabasePool().query<{
      id: string; status: string; item_id: string; name: string; inventory_number: string;
      requested_by: string; current_responsible_id_at_request: string; override_responsible_id: string | null;
      requester_name: string; owner_name: string;
    }>(
      `select transfer.id, transfer.status, transfer.item_id, item.name, item.inventory_number,
              transfer.requested_by, transfer.current_responsible_id_at_request, transfer.override_responsible_id,
              requester.full_name requester_name, owner.full_name owner_name
         from "yu_inventory"."transfers" transfer
         join "yu_inventory"."items" item on item.id = transfer.item_id
         join "yu_inventory"."users" requester on requester.id = transfer.requested_by
         join "yu_inventory"."users" owner on owner.id = transfer.current_responsible_id_at_request
        where transfer.id = $1`, [transferId]);
    const row = result.rows[0];
    if (!row) return;
    const item = `«${row.name}» (инв. № ${row.inventory_number})`;
    const notifications: WhatsAppNotification[] = [];
    if (row.status === "pending_current_owner") {
      notifications.push({ ticket: row.id, kind: "tmc_requested", recipientId: row.current_responsible_id_at_request,
        message: `Здравствуйте, ${row.owner_name}! ${row.requester_name} отправил(а) запрос на получение ТМЦ ${item}. Заявка № ${row.id}. Примите или отклоните запрос на сайте YU Inventory.` });
      notifications.push({ ticket: row.id, kind: "tmc_submitted", recipientId: row.requested_by,
        message: `Здравствуйте, ${row.requester_name}! Вы отправили запрос на получение ТМЦ ${item} текущему ответственному. Заявка № ${row.id}. Ожидайте решения на сайте YU Inventory.` });
    } else if (row.status === "confirmed" || row.status === "rejected") {
      notifications.push({ ticket: row.id, kind: row.status === "confirmed" ? "tmc_accepted" : "tmc_rejected", recipientId: row.requested_by,
        message: `Здравствуйте, ${row.requester_name}! Ваш запрос на получение ТМЦ ${item} ${row.status === "confirmed" ? "принят" : "отклонён"}. Заявка № ${row.id}. ${row.status === "confirmed" ? "Вы назначены ответственным. Согласуйте получение ТМЦ с предыдущим ответственным." : "Ответственный за ТМЦ не изменился."} Подробности — на сайте YU Inventory.` });
    } else if (row.status === "overridden" && row.override_responsible_id) {
      await notifyResponsibilityAssignedByWhatsApp({ ticket: row.id, itemId: row.item_id, itemName: row.name, inventoryNumber: row.inventory_number, responsibleUserId: row.override_responsible_id });
    }
    await deliver(notifications, notifyWhatsApp);
  } catch { console.warn("WhatsApp transfer notification failed", { transferId }); }
}
