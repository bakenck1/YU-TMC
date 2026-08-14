import type {
  InventoryItemOperationDto,
} from "@/lib/contracts/inventory-items";
import type { TranslationKey } from "@/lib/i18n";

export function operationTitle(
  entry: InventoryItemOperationDto,
  t: (key: TranslationKey) => string,
) {
  if (entry.kind === "item") return auditActionLabel(entry.action, t);
  const labels: Record<string, TranslationKey> = {
    "responsibility.accepted": "itemDetails.responsibilityAccepted",
    "responsibility.transferred": "itemDetails.responsibilityTransferred",
    "responsibility.admin_override": "itemDetails.responsibilityOverridden",
    "transfer.requested": "itemDetails.transferRequested",
    "transfer.confirmed": "itemDetails.transferConfirmed",
    "transfer.rejected": "itemDetails.transferRejected",
    "transfer.cancelled": "itemDetails.transferCancelled",
    "transfer.overridden": "itemDetails.transferOverridden",
    pending_current_owner: "itemDetails.transferRequested",
    confirmed: "itemDetails.transferConfirmed",
    rejected: "itemDetails.transferRejected",
    cancelled: "itemDetails.transferCancelled",
    overridden: "itemDetails.transferOverridden",
  };
  return t(labels[entry.action] ?? "itemDetails.responsibilityTransfer");
}

export function operationDetail(
  entry: InventoryItemOperationDto,
  t: (key: TranslationKey) => string,
) {
  if (!entry.detail) return ` · ${t("itemDetails.operationRecorded")}`;
  const parts: string[] = [];
  if (entry.detail.targetName) parts.push(entry.detail.targetName);
  if (entry.detail.itemName) parts.push(entry.detail.itemName);
  if (entry.detail.serviceName) parts.push(entry.detail.serviceName);
  if (entry.detail.componentName) parts.push(entry.detail.componentName);
  const inventoryNumber = entry.detail.componentInventoryNumber;
  if (inventoryNumber) parts.push(inventoryNumber);
  const fromRoom = entry.detail.fromLocation;
  const toRoom = entry.detail.toLocation;
  if (fromRoom && toRoom && fromRoom !== toRoom) {
    parts.push(`${fromRoom} → ${toRoom}`);
  }
  if (entry.detail.source) parts.push(localizeOperationValue(entry.detail.source, t));
  if (entry.detail.status) parts.push(localizeOperationValue(entry.detail.status, t));
  if (entry.detail.outcome === "released") parts.push(t("itemDetails.notAssigned"));
  if (entry.detail.comment) parts.push(entry.detail.comment);
  if (entry.detail.reason) parts.push(entry.detail.reason);
  if (!parts.length) parts.push(t("itemDetails.operationRecorded"));
  return ` · ${parts.join(", ")}`;
}

export function localizeItemError(
  cause: unknown,
  t: (key: TranslationKey) => string,
) {
  const code = cause instanceof Error ? cause.message : "";
  const direct: Record<string, TranslationKey> = {
    version_conflict: "itemDetails.errorConflict",
    forbidden: "itemDetails.errorForbidden",
    unauthorized: "itemDetails.errorUnauthorized",
    item_not_found: "itemDetails.errorNotFound",
    attachment_not_found: "itemDetails.errorNotFound",
    room_not_found: "itemDetails.errorRoomNotFound",
    inventory_number_already_exists: "itemDetails.errorInventoryNumber",
    qr_replace_reason_required: "itemDetails.errorQrReason",
    invalid_camera_photo: "itemDetails.errorPhoto",
    invalid_camera_photo_size: "itemDetails.errorPhoto",
    invalid_photo_dimensions: "itemDetails.errorPhoto",
    photo_save_failed: "itemDetails.errorPhoto",
    invalid_comment: "itemDetails.errorComment",
    invalid_comment_attachment: "itemDetails.errorComment",
    invalid_service_name: "itemDetails.errorService",
    invalid_service_reason: "itemDetails.errorService",
    service_photo_required: "itemDetails.errorServicePhoto",
    service_failed: "itemDetails.errorUnavailable",
    item_comments_unavailable: "itemDetails.errorUnavailable",
    items_unavailable: "itemDetails.errorUnavailable",
    internal_error: "itemDetails.errorUnavailable",
  };
  const invalidCodes = new Set([
    "invalid_request",
    "invalid_version",
    "invalid_item_name",
    "invalid_item_description",
    "invalid_item_type",
    "invalid_item_brand",
    "invalid_item_model",
    "invalid_item_quantity",
    "invalid_item_price",
    "invalid_inventory_number",
    "invalid_item_status",
    "invalid_room_id",
  ]);
  if (direct[code]) return t(direct[code]);
  if (invalidCodes.has(code)) return t("itemDetails.errorInvalidFields");
  if (cause instanceof TypeError) return t("itemDetails.errorUnavailable");
  return t("itemDetails.error");
}

export function responseErrorCode(status: number) {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "item_not_found";
  if (status === 409) return "version_conflict";
  return status >= 500 ? "items_unavailable" : "save_failed";
}

function localizeOperationValue(
  value: string,
  t: (key: TranslationKey) => string,
) {
  const labels: Record<string, TranslationKey> = {
    accepted: "itemDetails.responsibilityAccepted",
    admin_override: "itemDetails.responsibilityOverridden",
    transfer: "itemDetails.responsibilityTransferred",
    pending_current_owner: "itemDetails.transferRequested",
    confirmed: "itemDetails.transferConfirmed",
    rejected: "itemDetails.transferRejected",
    cancelled: "itemDetails.transferCancelled",
    overridden: "itemDetails.transferOverridden",
    active: "itemDetails.statusActive",
    maintenance: "itemDetails.statusMaintenance",
    decommissioned: "itemDetails.statusDecommissioned",
  };
  return labels[value] ? t(labels[value]) : value;
}

function auditActionLabel(
  action: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const labels: Record<string, TranslationKey> = {
    "item.created": "itemDetails.auditCreated",
    "item.content_updated": "itemDetails.auditContentUpdated",
    "item.photo_captured": "itemDetails.auditPhotoCaptured",
    "item.protected_fields_updated": "itemDetails.auditProtectedUpdated",
    "item.archived": "itemDetails.auditArchived",
    "item.sent_to_service": "itemDetails.auditSentToService",
    "item.component_added": "itemDetails.auditComponentAdded",
    "item.component_removed": "itemDetails.auditComponentRemoved",
  };
  return t(labels[action] ?? "itemDetails.auditUnknownAction");
}
