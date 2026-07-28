export const RECORD_STATUSES = ["active", "archived"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const ITEM_STATUSES = [
  "active",
  "maintenance",
  "decommissioned",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const INVENTORY_NUMBER_KINDS = ["official", "temporary"] as const;
export type InventoryNumberKind = (typeof INVENTORY_NUMBER_KINDS)[number];

export const QR_FORMATS = [
  "generated_v1",
  "legacy_raw",
  "legacy_url",
] as const;
export type QrFormat = (typeof QR_FORMATS)[number];

export const QR_TARGET_KINDS = ["building", "room", "item"] as const;
export type QrTargetKind = (typeof QR_TARGET_KINDS)[number];

export const QR_ROLES = ["primary", "alias"] as const;
export type QrRole = (typeof QR_ROLES)[number];

export const QR_STATUSES = ["active", "revoked"] as const;
export type QrStatus = (typeof QR_STATUSES)[number];

export const PHOTO_PURPOSES = [
  "item",
  "inspection_result",
  "decision_dispute",
] as const;
export type PhotoPurpose = (typeof PHOTO_PURPOSES)[number];

export const PHOTO_STATUSES = [
  "reserved",
  "attached",
  "superseded",
  "removed",
  "expired",
  "purged",
] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const RESPONSIBILITY_SOURCES = [
  "accepted",
  "transfer",
  "admin_override",
  "migration",
] as const;
export type ResponsibilitySource =
  (typeof RESPONSIBILITY_SOURCES)[number];

export const TRANSFER_STATUSES = [
  "pending_current_owner",
  "confirmed",
  "rejected",
  "cancelled",
  "overridden",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const INSPECTION_STATUSES = [
  "draft",
  "awaiting_decisions",
  "confirmed",
  "cancelled",
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const ITEM_RESULT_VALUES = [
  "present",
  "missing",
  "moved",
  "broken",
  "undetermined",
] as const;
export type ItemResultValue = (typeof ITEM_RESULT_VALUES)[number];

export const DECISION_RECIPIENT_KINDS = ["user", "admin_queue"] as const;
export type DecisionRecipientKind =
  (typeof DECISION_RECIPIENT_KINDS)[number];

export const DECISION_STATUSES = [
  "pending",
  "confirmed",
  "disputed",
  "superseded",
  "resolved_by_admin",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_RESOLUTIONS = [
  "confirm_result",
  "dismiss_to_present",
] as const;
export type DecisionResolution = (typeof DECISION_RESOLUTIONS)[number];

export const NOTIFICATION_EVENT_TYPES = [
  "transfer.requested",
  "transfer.confirmed",
  "transfer.rejected",
  "transfer.cancelled",
  "transfer.overridden",
  "decision.created",
  "decision.admin_queue_created",
  "decision.disputed",
  "decision.recheck_requested",
  "decision.closed_present",
  "decision.resolved_by_admin",
  "decision.admin_queue_resolved",
  "inspection.confirmed",
] as const;
export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_SUBJECT_KINDS = [
  "item",
  "transfer",
  "decision",
  "inspection",
] as const;
export type NotificationSubjectKind =
  (typeof NOTIFICATION_SUBJECT_KINDS)[number];

export const NOTIFICATION_AUDIENCE_KINDS = [
  "direct_user",
  "admin_queue",
] as const;
export type NotificationAudienceKind =
  (typeof NOTIFICATION_AUDIENCE_KINDS)[number];

export const NOTIFICATION_MAILBOX_KINDS = [
  "direct_user",
  "admin_queue",
] as const;
export type NotificationMailboxKind =
  (typeof NOTIFICATION_MAILBOX_KINDS)[number];

export const AUDIT_SUBJECT_KINDS = [
  "user",
  "building",
  "room",
  "item",
  "qr_identifier",
  "photo",
  "responsibility",
  "transfer",
  "inspection",
  "inspection_room",
  "item_result",
  "deviation_decision",
  "notification",
] as const;
export type AuditSubjectKind = (typeof AUDIT_SUBJECT_KINDS)[number];
