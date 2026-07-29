import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  AUDIT_SUBJECT_KINDS,
  DECISION_RECIPIENT_KINDS,
  DECISION_RESOLUTIONS,
  DECISION_STATUSES,
  INSPECTION_STATUSES,
  IDEMPOTENCY_STATES,
  INVENTORY_NUMBER_KINDS,
  ITEM_RESULT_VALUES,
  ITEM_STATUSES,
  NOTIFICATION_AUDIENCE_KINDS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_MAILBOX_KINDS,
  NOTIFICATION_SUBJECT_KINDS,
  PHOTO_PURPOSES,
  PHOTO_STATUSES,
  QR_FORMATS,
  QR_ROLES,
  QR_STATUSES,
  QR_TARGET_KINDS,
  RECORD_STATUSES,
  RESPONSIBILITY_SOURCES,
  TRANSFER_OVERRIDE_OUTCOMES,
  TRANSFER_STATUSES,
} from "@/lib/contracts/inventory-domain";
import { USER_ROLES } from "@/lib/contracts/users";

/**
 * All application tables are schema-qualified so PostgreSQL's public schema is
 * never an implicit source of application objects. Drizzle does not record an
 * empty pgSchema in its snapshot or generate CREATE SCHEMA for its first table;
 * the committed bootstrap migration deliberately creates this namespace.
 */
export const inventorySchema = pgSchema("yu_inventory");

export const authRoleEnum = inventorySchema.enum("auth_role", USER_ROLES);
export const recordStatusEnum = inventorySchema.enum(
  "record_status",
  RECORD_STATUSES,
);
export const itemStatusEnum = inventorySchema.enum(
  "item_status",
  ITEM_STATUSES,
);
export const inventoryNumberKindEnum = inventorySchema.enum(
  "inventory_number_kind",
  INVENTORY_NUMBER_KINDS,
);
export const qrFormatEnum = inventorySchema.enum("qr_format", QR_FORMATS);
export const qrTargetKindEnum = inventorySchema.enum(
  "qr_target_kind",
  QR_TARGET_KINDS,
);
export const qrRoleEnum = inventorySchema.enum("qr_role", QR_ROLES);
export const qrStatusEnum = inventorySchema.enum("qr_status", QR_STATUSES);
export const photoPurposeEnum = inventorySchema.enum(
  "photo_purpose",
  PHOTO_PURPOSES,
);
export const photoStatusEnum = inventorySchema.enum(
  "photo_status",
  PHOTO_STATUSES,
);
export const responsibilitySourceEnum = inventorySchema.enum(
  "responsibility_source",
  RESPONSIBILITY_SOURCES,
);
export const transferStatusEnum = inventorySchema.enum(
  "transfer_status",
  TRANSFER_STATUSES,
);
export const transferOverrideOutcomeEnum = inventorySchema.enum(
  "transfer_override_outcome",
  TRANSFER_OVERRIDE_OUTCOMES,
);
export const inspectionStatusEnum = inventorySchema.enum(
  "inspection_status",
  INSPECTION_STATUSES,
);
export const itemResultValueEnum = inventorySchema.enum(
  "item_result_value",
  ITEM_RESULT_VALUES,
);
export const decisionRecipientKindEnum = inventorySchema.enum(
  "decision_recipient_kind",
  DECISION_RECIPIENT_KINDS,
);
export const decisionStatusEnum = inventorySchema.enum(
  "decision_status",
  DECISION_STATUSES,
);
export const decisionResolutionEnum = inventorySchema.enum(
  "decision_resolution",
  DECISION_RESOLUTIONS,
);
export const notificationEventTypeEnum = inventorySchema.enum(
  "notification_event_type",
  NOTIFICATION_EVENT_TYPES,
);
export const notificationSubjectKindEnum = inventorySchema.enum(
  "notification_subject_kind",
  NOTIFICATION_SUBJECT_KINDS,
);
export const notificationAudienceKindEnum = inventorySchema.enum(
  "notification_audience_kind",
  NOTIFICATION_AUDIENCE_KINDS,
);
export const notificationMailboxKindEnum = inventorySchema.enum(
  "notification_mailbox_kind",
  NOTIFICATION_MAILBOX_KINDS,
);
export const auditSubjectKindEnum = inventorySchema.enum(
  "audit_subject_kind",
  AUDIT_SUBJECT_KINDS,
);
export const idempotencyStateEnum = inventorySchema.enum(
  "idempotency_state",
  IDEMPOTENCY_STATES,
);

export const userCodeSequence = inventorySchema.sequence(
  "user_code_sequence",
  {
    startWith: 1,
    increment: 1,
    minValue: 1,
    cache: 1,
  },
);

export const usersTable = inventorySchema.table(
  "users",
  {
    id: uuid().primaryKey(),
    code: varchar({ length: 32 }).notNull().unique(),
    email: varchar({ length: 254 }).notNull().unique(),
    fullName: varchar({ length: 120 }).notNull(),
    role: authRoleEnum().notNull(),
    phone: varchar({ length: 32 }),
    emailVerified: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    deactivatedAt: timestamp({ withTimezone: true, mode: "date" }),
    deletedAt: timestamp({ withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
    check("users_version_positive_check", sql`${table.version} > 0`),
    check(
      "users_deactivated_state_check",
      sql`${table.isActive} OR ${table.deactivatedAt} IS NOT NULL`,
    ),
  ],
);

export const userPasswordCredentialsTable = inventorySchema.table(
  "user_password_credentials",
  {
    userId: uuid()
      .primaryKey()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    algorithm: varchar({ length: 16 }).notNull().default("scrypt"),
    salt: text().notNull(),
    hash: text().notNull(),
    scryptN: integer().notNull().default(16_384),
    scryptR: integer().notNull().default(8),
    scryptP: integer().notNull().default(1),
    keyLength: integer().notNull().default(64),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check(
      "user_password_credentials_algorithm_check",
      sql`${table.algorithm} = 'scrypt'`,
    ),
    check(
      "user_password_credentials_hash_check",
      sql`${table.hash} ~ '^[0-9a-f]{128}$'`,
    ),
    check(
      "user_password_credentials_parameters_check",
      sql`${table.scryptN} = 16384 AND ${table.scryptR} = 8 AND ${table.scryptP} = 1 AND ${table.keyLength} = 64`,
    ),
  ],
);

export const authBootstrapTable = inventorySchema.table(
  "auth_bootstrap",
  {
    singleton: boolean().primaryKey().default(true),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    firstAdminUserId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    check("auth_bootstrap_singleton_check", sql`${table.singleton} = true`),
    check(
      "auth_bootstrap_completion_check",
      sql`(${table.completedAt} IS NULL) = (${table.firstAdminUserId} IS NULL)`,
    ),
  ],
);

export const buildingsTable = inventorySchema.table(
  "buildings",
  {
    id: uuid().primaryKey(),
    name: varchar({ length: 120 }).notNull(),
    nameKey: text().notNull(),
    address: varchar({ length: 300 }).notNull(),
    addressKey: text().notNull(),
    status: recordStatusEnum().notNull().default("active"),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    updatedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    archivedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp({ withTimezone: true, mode: "date" }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check(
      "buildings_display_values_check",
      sql`btrim(${table.name}) <> '' AND btrim(${table.nameKey}) <> '' AND btrim(${table.address}) <> '' AND btrim(${table.addressKey}) <> ''`,
    ),
    check(
      "buildings_archive_state_check",
      sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)
          OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL)`,
    ),
    check("buildings_version_check", sql`${table.version} > 0`),
    index("buildings_status_idx").on(table.status),
    index("buildings_name_address_key_idx").on(
      table.nameKey,
      table.addressKey,
    ),
    index("buildings_created_by_idx").on(table.createdBy),
    index("buildings_updated_by_idx").on(table.updatedBy),
  ],
);

export const roomsTable = inventorySchema.table(
  "rooms",
  {
    id: uuid().primaryKey(),
    buildingId: uuid()
      .notNull()
      .references(() => buildingsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    designation: varchar({ length: 80 }).notNull(),
    designationKey: text().notNull(),
    floorNumber: integer().notNull(),
    floorLabel: varchar({ length: 40 }),
    status: recordStatusEnum().notNull().default("active"),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    updatedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    archivedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp({ withTimezone: true, mode: "date" }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check(
      "rooms_display_values_check",
      sql`btrim(${table.designation}) <> '' AND btrim(${table.designationKey}) <> ''
          AND (${table.floorLabel} IS NULL OR btrim(${table.floorLabel}) <> '')`,
    ),
    check(
      "rooms_floor_number_check",
      sql`${table.floorNumber} BETWEEN -5 AND 200`,
    ),
    check(
      "rooms_archive_state_check",
      sql`(${table.status} = 'active' AND ${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)
          OR (${table.status} = 'archived' AND ${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL)`,
    ),
    check("rooms_version_check", sql`${table.version} > 0`),
    index("rooms_building_idx").on(table.buildingId),
    index("rooms_building_status_idx").on(table.buildingId, table.status),
    index("rooms_lookup_idx").on(
      table.buildingId,
      table.floorNumber,
      table.designationKey,
    ),
    unique("rooms_id_building_unique").on(
      table.id,
      table.buildingId,
    ),
    index("rooms_created_by_idx").on(table.createdBy),
    index("rooms_updated_by_idx").on(table.updatedBy),
  ],
);

export const inspectionsTable = inventorySchema.table(
  "inspections",
  {
    id: uuid().primaryKey(),
    name: varchar({ length: 120 }).notNull(),
    technicianId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: inspectionStatusEnum().notNull().default("draft"),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    walkthroughCompletedAt: timestamp({
      withTimezone: true,
      mode: "date",
    }),
    confirmedAt: timestamp({ withTimezone: true, mode: "date" }),
    cancelledAt: timestamp({ withTimezone: true, mode: "date" }),
    cancelledBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    cancelReason: varchar({ length: 1000 }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check("inspections_name_check", sql`btrim(${table.name}) <> ''`),
    check(
      "inspections_state_check",
      sql`(
            ${table.status} = 'draft'
            AND ${table.walkthroughCompletedAt} IS NULL
            AND ${table.confirmedAt} IS NULL
            AND ${table.cancelledAt} IS NULL
            AND ${table.cancelledBy} IS NULL
            AND ${table.cancelReason} IS NULL
          ) OR (
            ${table.status} = 'awaiting_decisions'
            AND ${table.walkthroughCompletedAt} IS NOT NULL
            AND ${table.confirmedAt} IS NULL
            AND ${table.cancelledAt} IS NULL
            AND ${table.cancelledBy} IS NULL
            AND ${table.cancelReason} IS NULL
          ) OR (
            ${table.status} = 'confirmed'
            AND ${table.walkthroughCompletedAt} IS NOT NULL
            AND ${table.confirmedAt} IS NOT NULL
            AND ${table.cancelledAt} IS NULL
            AND ${table.cancelledBy} IS NULL
            AND ${table.cancelReason} IS NULL
          ) OR (
            ${table.status} = 'cancelled'
            AND ${table.walkthroughCompletedAt} IS NULL
            AND ${table.confirmedAt} IS NULL
            AND ${table.cancelledAt} IS NOT NULL
            AND ${table.cancelledBy} IS NOT NULL
            AND ${table.cancelReason} IS NOT NULL
            AND btrim(${table.cancelReason}) <> ''
          )`,
    ),
    check("inspections_version_check", sql`${table.version} > 0`),
    index("inspections_technician_status_idx").on(
      table.technicianId,
      table.status,
    ),
    index("inspections_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    index("inspections_created_by_idx").on(table.createdBy),
  ],
);

export const itemsTable = inventorySchema.table(
  "items",
  {
    id: uuid().primaryKey(),
    name: varchar({ length: 160 }).notNull(),
    description: text(),
    itemType: varchar({ length: 120 }).notNull().default("ТМЦ"),
    brand: varchar({ length: 120 }),
    model: varchar({ length: 160 }),
    quantity: integer().notNull().default(1),
    unitPrice: numeric({ precision: 14, scale: 2 }).notNull().default("0"),
    roomId: uuid()
      .notNull()
      .references(() => roomsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    inventoryNumberKind: inventoryNumberKindEnum().notNull(),
    inventoryNumber: varchar({ length: 64 }).notNull(),
    inventoryNumberKey: text().notNull(),
    status: itemStatusEnum().notNull().default("active"),
    createdInInspectionId: uuid().references(() => inspectionsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    updatedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp({ withTimezone: true, mode: "date" }),
    archivedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check(
      "items_display_values_check",
      sql`btrim(${table.name}) <> ''
          AND (${table.description} IS NULL OR btrim(${table.description}) <> '')
          AND btrim(${table.itemType}) <> ''
          AND btrim(${table.inventoryNumber}) <> ''
          AND btrim(${table.inventoryNumberKey}) <> ''
          AND ${table.quantity} > 0
          AND ${table.unitPrice} >= 0`,
    ),
    check(
      "items_archive_state_check",
      sql`(${table.archivedAt} IS NULL) = (${table.archivedBy} IS NULL)`,
    ),
    check("items_version_check", sql`${table.version} > 0`),
    uniqueIndex("items_inventory_number_key_unique").on(
      table.inventoryNumberKey,
    ),
    index("items_room_status_idx").on(table.roomId, table.status),
    index("items_status_idx").on(table.status),
    index("items_inventory_number_key_idx").on(table.inventoryNumberKey),
    index("items_created_in_inspection_idx").on(
      table.createdInInspectionId,
    ),
    index("items_created_by_idx").on(table.createdBy),
    index("items_updated_by_idx").on(table.updatedBy),
  ],
);

export const itemInventoryNumberHistoryTable = inventorySchema.table(
  "item_inventory_number_history",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => itemsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    kind: inventoryNumberKindEnum().notNull(),
    value: varchar({ length: 64 }).notNull(),
    comparisonKey: text().notNull(),
    assignedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    assignedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    replacedAt: timestamp({ withTimezone: true, mode: "date" }),
    replacedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    reason: varchar({ length: 1000 }),
  },
  (table) => [
    check(
      "item_inventory_number_history_value_check",
      sql`btrim(${table.value}) <> '' AND btrim(${table.comparisonKey}) <> ''`,
    ),
    check(
      "item_inventory_number_history_replacement_check",
      sql`(
            ${table.replacedAt} IS NULL
            AND ${table.replacedBy} IS NULL
            AND ${table.reason} IS NULL
          ) OR (
            ${table.replacedAt} IS NOT NULL
            AND ${table.replacedBy} IS NOT NULL
            AND ${table.replacedAt} >= ${table.assignedAt}
            AND ${table.reason} IS NOT NULL
            AND btrim(${table.reason}) <> ''
          )`,
    ),
    index("item_inventory_number_history_item_idx").on(
      table.itemId,
      table.assignedAt,
    ),
    index("item_inventory_number_history_key_idx").on(table.comparisonKey),
    uniqueIndex("item_inventory_number_history_key_unique").on(
      table.comparisonKey,
    ),
    uniqueIndex("item_inventory_number_history_open_item_unique")
      .on(table.itemId)
      .where(sql`${table.replacedAt} IS NULL`),
    index("item_inventory_number_history_assigned_by_idx").on(
      table.assignedBy,
    ),
  ],
);

export const qrIdentifiersTable = inventorySchema.table(
  "qr_identifiers",
  {
    id: uuid().primaryKey(),
    originalValue: text().notNull(),
    canonicalKey: text().notNull(),
    format: qrFormatEnum().notNull(),
    targetKind: qrTargetKindEnum().notNull(),
    role: qrRoleEnum().notNull(),
    status: qrStatusEnum().notNull().default("active"),
    buildingId: uuid().references(() => buildingsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    roomId: uuid().references(() => roomsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    itemId: uuid().references(() => itemsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    revokeReason: varchar({ length: 1000 }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check(
      "qr_identifiers_values_check",
      sql`btrim(${table.originalValue}) <> ''
          AND btrim(${table.canonicalKey}) <> ''
          AND octet_length(${table.originalValue}) <= 512
          AND octet_length(${table.canonicalKey}) <= 512`,
    ),
    check(
      "qr_identifiers_target_check",
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.itemId}) = 1
          AND (
            (${table.targetKind} = 'building' AND ${table.buildingId} IS NOT NULL)
            OR (${table.targetKind} = 'room' AND ${table.roomId} IS NOT NULL)
            OR (${table.targetKind} = 'item' AND ${table.itemId} IS NOT NULL)
          )`,
    ),
    check(
      "qr_identifiers_revocation_check",
      sql`(
            ${table.status} = 'active'
            AND ${table.revokedBy} IS NULL
            AND ${table.revokedAt} IS NULL
            AND ${table.revokeReason} IS NULL
          ) OR (
            ${table.status} = 'revoked'
            AND ${table.revokedBy} IS NOT NULL
            AND ${table.revokedAt} IS NOT NULL
            AND ${table.revokeReason} IS NOT NULL
            AND btrim(${table.revokeReason}) <> ''
          )`,
    ),
    check(
      "qr_identifiers_generated_format_check",
      sql`${table.format} <> 'generated_v1'
          OR (
            ${table.role} = 'primary'
            AND ${table.canonicalKey} ~ '^YUQ1:[0-9A-HJKMNP-TV-Z]{26}$'
          )`,
    ),
    check("qr_identifiers_version_check", sql`${table.version} > 0`),
    uniqueIndex("qr_identifiers_canonical_key_unique").on(
      table.canonicalKey,
    ),
    uniqueIndex("qr_identifiers_active_primary_building_unique")
      .on(table.buildingId)
      .where(
        sql`${table.status} = 'active' AND ${table.role} = 'primary' AND ${table.buildingId} IS NOT NULL`,
      ),
    uniqueIndex("qr_identifiers_active_primary_room_unique")
      .on(table.roomId)
      .where(
        sql`${table.status} = 'active' AND ${table.role} = 'primary' AND ${table.roomId} IS NOT NULL`,
      ),
    uniqueIndex("qr_identifiers_active_primary_item_unique")
      .on(table.itemId)
      .where(
        sql`${table.status} = 'active' AND ${table.role} = 'primary' AND ${table.itemId} IS NOT NULL`,
      ),
    index("qr_identifiers_building_status_idx").on(
      table.buildingId,
      table.status,
    ),
    index("qr_identifiers_room_status_idx").on(
      table.roomId,
      table.status,
    ),
    index("qr_identifiers_item_status_idx").on(
      table.itemId,
      table.status,
    ),
    index("qr_identifiers_created_by_idx").on(table.createdBy),
  ],
);

export const responsibilityPeriodsTable = inventorySchema.table(
  "responsibility_periods",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => itemsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    responsibleUserId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    source: responsibilitySourceEnum().notNull(),
    startedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    startedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    endedAt: timestamp({ withTimezone: true, mode: "date" }),
    endedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    endReason: varchar({ length: 1000 }),
  },
  (table) => [
    check(
      "responsibility_periods_acceptance_actor_check",
      sql`${table.source} <> 'accepted'
          OR ${table.startedBy} = ${table.responsibleUserId}`,
    ),
    check(
      "responsibility_periods_end_state_check",
      sql`(
            ${table.endedAt} IS NULL
            AND ${table.endedBy} IS NULL
            AND ${table.endReason} IS NULL
          ) OR (
            ${table.endedAt} IS NOT NULL
            AND ${table.endedBy} IS NOT NULL
            AND ${table.endedAt} >= ${table.startedAt}
            AND ${table.endReason} IS NOT NULL
            AND btrim(${table.endReason}) <> ''
          )`,
    ),
    index("responsibility_periods_item_time_idx").on(
      table.itemId,
      table.startedAt,
    ),
    index("responsibility_periods_user_open_idx").on(
      table.responsibleUserId,
      table.endedAt,
    ),
    index("responsibility_periods_started_by_idx").on(table.startedBy),
    uniqueIndex("responsibility_periods_open_item_unique")
      .on(table.itemId)
      .where(sql`${table.endedAt} IS NULL`),
  ],
);

export const transfersTable = inventorySchema.table(
  "transfers",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => itemsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    requestedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    proposedResponsibleId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    currentResponsibleIdAtRequest: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: transferStatusEnum()
      .notNull()
      .default("pending_current_owner"),
    requestedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    closedAt: timestamp({ withTimezone: true, mode: "date" }),
    closedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    decisionComment: varchar({ length: 1000 }),
    administrativeReason: varchar({ length: 1000 }),
    overrideOutcome: transferOverrideOutcomeEnum(),
    overrideResponsibleId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    version: integer().notNull().default(1),
  },
  (table) => [
    check(
      "transfers_requester_is_proposed_check",
      sql`${table.requestedBy} = ${table.proposedResponsibleId}`,
    ),
    check(
      "transfers_distinct_responsible_users_check",
      sql`${table.proposedResponsibleId} <> ${table.currentResponsibleIdAtRequest}`,
    ),
    check(
      "transfers_state_check",
      sql`(
            ${table.status} = 'pending_current_owner'
            AND ${table.closedAt} IS NULL
            AND ${table.closedBy} IS NULL
            AND ${table.decisionComment} IS NULL
            AND ${table.administrativeReason} IS NULL
            AND ${table.overrideOutcome} IS NULL
            AND ${table.overrideResponsibleId} IS NULL
          ) OR (
            ${table.status} <> 'pending_current_owner'
            AND ${table.closedAt} IS NOT NULL
            AND ${table.closedBy} IS NOT NULL
          )`,
    ),
    check(
      "transfers_closure_actor_check",
      sql`${table.status} = 'pending_current_owner'
          OR (
            ${table.status} IN ('confirmed', 'rejected')
            AND ${table.closedBy} = ${table.currentResponsibleIdAtRequest}
          ) OR (
            ${table.status} = 'cancelled'
            AND ${table.closedBy} = ${table.requestedBy}
          ) OR ${table.status} = 'overridden'`,
    ),
    check(
      "transfers_decision_comment_check",
      sql`(
            ${table.status} = 'rejected'
            AND ${table.decisionComment} IS NOT NULL
            AND btrim(${table.decisionComment}) <> ''
          ) OR (
            ${table.status} <> 'rejected'
            AND ${table.decisionComment} IS NULL
          )`,
    ),
    check(
      "transfers_override_state_check",
      sql`(
            ${table.status} = 'overridden'
            AND ${table.administrativeReason} IS NOT NULL
            AND btrim(${table.administrativeReason}) <> ''
            AND (
              (
                ${table.overrideOutcome} = 'assigned'
                AND ${table.overrideResponsibleId} IS NOT NULL
              ) OR (
                ${table.overrideOutcome} = 'released'
                AND ${table.overrideResponsibleId} IS NULL
              )
            )
          ) OR (
            ${table.status} <> 'overridden'
            AND ${table.administrativeReason} IS NULL
            AND ${table.overrideOutcome} IS NULL
            AND ${table.overrideResponsibleId} IS NULL
          )`,
    ),
    check("transfers_version_check", sql`${table.version} > 0`),
    uniqueIndex("transfers_pending_item_unique")
      .on(table.itemId)
      .where(sql`${table.status} = 'pending_current_owner'`),
    index("transfers_item_status_idx").on(table.itemId, table.status),
    index("transfers_current_owner_status_idx").on(
      table.currentResponsibleIdAtRequest,
      table.status,
    ),
    index("transfers_proposed_owner_status_idx").on(
      table.proposedResponsibleId,
      table.status,
    ),
    index("transfers_requested_by_idx").on(table.requestedBy),
    index("transfers_override_responsible_idx").on(
      table.overrideResponsibleId,
    ),
  ],
);

export const inspectionRoomsTable = inventorySchema.table(
  "inspection_rooms",
  {
    id: uuid().primaryKey(),
    inspectionId: uuid()
      .notNull()
      .references(() => inspectionsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    buildingId: uuid()
      .notNull()
      .references(() => buildingsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    roomId: uuid().notNull(),
    buildingNameSnapshot: varchar({ length: 120 }).notNull(),
    buildingAddressSnapshot: varchar({ length: 300 }).notNull(),
    roomDesignationSnapshot: varchar({ length: 80 }).notNull(),
    roomFloorNumberSnapshot: integer().notNull(),
    roomFloorLabelSnapshot: varchar({ length: 40 }),
    addedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    addedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    inspectedAt: timestamp({ withTimezone: true, mode: "date" }),
    inspectedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
  },
  (table) => [
    foreignKey({
      name: "inspection_rooms_room_building_fk",
      columns: [table.roomId, table.buildingId],
      foreignColumns: [roomsTable.id, roomsTable.buildingId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "inspection_rooms_snapshot_check",
      sql`btrim(${table.buildingNameSnapshot}) <> ''
          AND btrim(${table.buildingAddressSnapshot}) <> ''
          AND btrim(${table.roomDesignationSnapshot}) <> ''
          AND ${table.roomFloorNumberSnapshot} BETWEEN -5 AND 200
          AND (
            ${table.roomFloorLabelSnapshot} IS NULL
            OR btrim(${table.roomFloorLabelSnapshot}) <> ''
          )`,
    ),
    check(
      "inspection_rooms_inspected_state_check",
      sql`(${table.inspectedAt} IS NULL) = (${table.inspectedBy} IS NULL)`,
    ),
    unique("inspection_rooms_inspection_room_unique").on(
      table.inspectionId,
      table.roomId,
    ),
    unique("inspection_rooms_id_inspection_unique").on(
      table.id,
      table.inspectionId,
    ),
    unique("inspection_rooms_id_room_unique").on(
      table.id,
      table.roomId,
    ),
    index("inspection_rooms_inspection_idx").on(table.inspectionId),
    index("inspection_rooms_room_idx").on(table.roomId),
    index("inspection_rooms_building_idx").on(table.buildingId),
    index("inspection_rooms_added_by_idx").on(table.addedBy),
  ],
);

export const inspectionRoomItemsTable = inventorySchema.table(
  "inspection_room_items",
  {
    inspectionRoomId: uuid().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => itemsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    registryRoomId: uuid().notNull(),
    responsibleUserId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    itemNameSnapshot: varchar({ length: 160 }).notNull(),
    inventoryNumberKindSnapshot: inventoryNumberKindEnum().notNull(),
    inventoryNumberSnapshot: varchar({ length: 64 }).notNull(),
    buildingNameSnapshot: varchar({ length: 120 }).notNull(),
    roomDesignationSnapshot: varchar({ length: 80 }).notNull(),
    capturedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "inspection_room_items_room_context_fk",
      columns: [table.inspectionRoomId, table.registryRoomId],
      foreignColumns: [inspectionRoomsTable.id, inspectionRoomsTable.roomId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    primaryKey({
      name: "inspection_room_items_pk",
      columns: [table.inspectionRoomId, table.itemId],
    }),
    check(
      "inspection_room_items_snapshot_check",
      sql`btrim(${table.itemNameSnapshot}) <> ''
          AND btrim(${table.inventoryNumberSnapshot}) <> ''
          AND btrim(${table.buildingNameSnapshot}) <> ''
          AND btrim(${table.roomDesignationSnapshot}) <> ''`,
    ),
    index("inspection_room_items_item_idx").on(table.itemId),
    index("inspection_room_items_registry_room_idx").on(
      table.registryRoomId,
    ),
    index("inspection_room_items_responsible_user_idx").on(
      table.responsibleUserId,
    ),
  ],
);

export const itemResultsTable = inventorySchema.table(
  "item_results",
  {
    id: uuid().primaryKey(),
    inspectionId: uuid().notNull(),
    inspectionRoomId: uuid().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => itemsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    registryRoomIdAtScan: uuid()
      .notNull()
      .references(() => roomsTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    responsibleIdAtScan: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    decisionRecipientKindAtScan: decisionRecipientKindEnum().notNull(),
    itemNameSnapshot: varchar({ length: 160 }).notNull(),
    inventoryNumberKindSnapshot: inventoryNumberKindEnum().notNull(),
    inventoryNumberSnapshot: varchar({ length: 64 }).notNull(),
    buildingNameSnapshot: varchar({ length: 120 }).notNull(),
    roomDesignationSnapshot: varchar({ length: 80 }).notNull(),
    isNewItem: boolean().notNull().default(false),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "item_results_inspection_room_context_fk",
      columns: [table.inspectionRoomId, table.inspectionId],
      foreignColumns: [
        inspectionRoomsTable.id,
        inspectionRoomsTable.inspectionId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "item_results_snapshot_check",
      sql`btrim(${table.itemNameSnapshot}) <> ''
          AND btrim(${table.inventoryNumberSnapshot}) <> ''
          AND btrim(${table.buildingNameSnapshot}) <> ''
          AND btrim(${table.roomDesignationSnapshot}) <> ''`,
    ),
    check(
      "item_results_recipient_snapshot_check",
      sql`(
            ${table.decisionRecipientKindAtScan} = 'user'
            AND ${table.responsibleIdAtScan} IS NOT NULL
          ) OR (
            ${table.decisionRecipientKindAtScan} = 'admin_queue'
            AND ${table.responsibleIdAtScan} IS NULL
          )`,
    ),
    unique("item_results_id_inspection_room_unique").on(
      table.id,
      table.inspectionRoomId,
    ),
    unique("item_results_id_recipient_kind_unique").on(
      table.id,
      table.decisionRecipientKindAtScan,
    ),
    unique("item_results_id_responsible_unique").on(
      table.id,
      table.responsibleIdAtScan,
    ),
    index("item_results_inspection_idx").on(table.inspectionId),
    index("item_results_inspection_room_idx").on(table.inspectionRoomId),
    index("item_results_item_idx").on(table.itemId),
    index("item_results_responsible_at_scan_idx").on(
      table.responsibleIdAtScan,
    ),
    index("item_results_registry_room_idx").on(
      table.registryRoomIdAtScan,
    ),
    uniqueIndex("item_results_inspection_item_unique").on(
      table.inspectionId,
      table.itemId,
    ),
  ],
);

export const itemResultRevisionsTable = inventorySchema.table(
  "item_result_revisions",
  {
    resultId: uuid().notNull(),
    revisionNumber: integer().notNull(),
    result: itemResultValueEnum().notNull(),
    inspectionRoomId: uuid().notNull(),
    observedRoomId: uuid()
      .notNull(),
    comment: varchar({ length: 1000 }),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    administrativeReason: varchar({ length: 1000 }),
  },
  (table) => [
    foreignKey({
      name: "item_result_revisions_result_context_fk",
      columns: [table.resultId, table.inspectionRoomId],
      foreignColumns: [
        itemResultsTable.id,
        itemResultsTable.inspectionRoomId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "item_result_revisions_observed_room_context_fk",
      columns: [table.inspectionRoomId, table.observedRoomId],
      foreignColumns: [inspectionRoomsTable.id, inspectionRoomsTable.roomId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    primaryKey({
      name: "item_result_revisions_pk",
      columns: [table.resultId, table.revisionNumber],
    }),
    check(
      "item_result_revisions_number_check",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "item_result_revisions_comment_check",
      sql`${table.comment} IS NULL OR btrim(${table.comment}) <> ''`,
    ),
    index("item_result_revisions_observed_room_idx").on(
      table.inspectionRoomId,
      table.observedRoomId,
    ),
    index("item_result_revisions_created_by_idx").on(table.createdBy),
  ],
);

export const deviationDecisionsTable = inventorySchema.table(
  "deviation_decisions",
  {
    id: uuid().primaryKey(),
    resultId: uuid().notNull(),
    resultRevisionNumber: integer().notNull(),
    previousDecisionId: uuid(),
    recipientKind: decisionRecipientKindEnum().notNull(),
    recipientId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    status: decisionStatusEnum().notNull().default("pending"),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    actedAt: timestamp({ withTimezone: true, mode: "date" }),
    actedBy: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    comment: varchar({ length: 1000 }),
    resolution: decisionResolutionEnum(),
    administrativeReason: varchar({ length: 1000 }),
    version: integer().notNull().default(1),
  },
  (table) => [
    foreignKey({
      name: "deviation_decisions_result_revision_fk",
      columns: [table.resultId, table.resultRevisionNumber],
      foreignColumns: [
        itemResultRevisionsTable.resultId,
        itemResultRevisionsTable.revisionNumber,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "deviation_decisions_previous_result_fk",
      columns: [table.previousDecisionId, table.resultId],
      foreignColumns: [table.id, table.resultId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "deviation_decisions_recipient_kind_snapshot_fk",
      columns: [table.resultId, table.recipientKind],
      foreignColumns: [
        itemResultsTable.id,
        itemResultsTable.decisionRecipientKindAtScan,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "deviation_decisions_recipient_user_snapshot_fk",
      columns: [table.resultId, table.recipientId],
      foreignColumns: [
        itemResultsTable.id,
        itemResultsTable.responsibleIdAtScan,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "deviation_decisions_recipient_check",
      sql`(${table.recipientKind} = 'user' AND ${table.recipientId} IS NOT NULL)
          OR (${table.recipientKind} = 'admin_queue' AND ${table.recipientId} IS NULL)`,
    ),
    check(
      "deviation_decisions_state_check",
      sql`(
            ${table.status} = 'pending'
            AND ${table.actedAt} IS NULL
            AND ${table.actedBy} IS NULL
            AND ${table.resolution} IS NULL
          ) OR (
            ${table.status} <> 'pending'
            AND ${table.actedAt} IS NOT NULL
            AND ${table.actedBy} IS NOT NULL
          )`,
    ),
    check(
      "deviation_decisions_resolution_check",
      sql`(${table.status} = 'resolved_by_admin') = (${table.resolution} IS NOT NULL)`,
    ),
    check(
      "deviation_decisions_recipient_actor_check",
      sql`${table.status} NOT IN ('confirmed', 'disputed')
          OR (
            ${table.recipientKind} = 'user'
            AND ${table.actedBy} = ${table.recipientId}
          )`,
    ),
    check(
      "deviation_decisions_dispute_comment_check",
      sql`${table.status} <> 'disputed'
          OR (
            ${table.comment} IS NOT NULL
            AND btrim(${table.comment}) <> ''
          )`,
    ),
    check(
      "deviation_decisions_administrative_reason_scope_check",
      sql`(
            ${table.status} = 'resolved_by_admin'
            AND ${table.administrativeReason} IS NOT NULL
            AND btrim(${table.administrativeReason}) <> ''
          ) OR (
            ${table.status} <> 'resolved_by_admin'
            AND ${table.administrativeReason} IS NULL
          )`,
    ),
    check(
      "deviation_decisions_comment_check",
      sql`${table.comment} IS NULL OR btrim(${table.comment}) <> ''`,
    ),
    check(
      "deviation_decisions_previous_not_self_check",
      sql`${table.previousDecisionId} IS NULL OR ${table.previousDecisionId} <> ${table.id}`,
    ),
    check("deviation_decisions_version_check", sql`${table.version} > 0`),
    uniqueIndex("deviation_decisions_pending_result_unique")
      .on(table.resultId)
      .where(sql`${table.status} = 'pending'`),
    unique("deviation_decisions_id_result_unique").on(
      table.id,
      table.resultId,
    ),
    index("deviation_decisions_recipient_status_idx").on(
      table.recipientId,
      table.status,
    ),
    index("deviation_decisions_result_status_idx").on(
      table.resultId,
      table.resultRevisionNumber,
      table.status,
    ),
    index("deviation_decisions_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    index("deviation_decisions_previous_idx").on(table.previousDecisionId),
    index("deviation_decisions_created_by_idx").on(table.createdBy),
  ],
);

export const photosTable = inventorySchema.table(
  "photos",
  {
    id: uuid().primaryKey(),
    purpose: photoPurposeEnum().notNull(),
    status: photoStatusEnum().notNull().default("reserved"),
    uploadedBy: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    originalObjectKey: varchar({ length: 1024 }).notNull(),
    previewObjectKey: varchar({ length: 1024 }),
    trustedMimeType: varchar({ length: 32 }),
    byteSize: integer(),
    width: integer(),
    height: integer(),
    checksumSha256: varchar({ length: 64 }),
    reservedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    attachedAt: timestamp({ withTimezone: true, mode: "date" }),
    supersededAt: timestamp({ withTimezone: true, mode: "date" }),
    removedAt: timestamp({ withTimezone: true, mode: "date" }),
    binaryDeletedAt: timestamp({ withTimezone: true, mode: "date" }),
    itemId: uuid().references(() => itemsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    resultId: uuid(),
    resultRevisionNumber: integer(),
    decisionId: uuid().references(() => deviationDecisionsTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    version: integer().notNull().default(1),
  },
  (table) => [
    foreignKey({
      name: "photos_result_revision_fk",
      columns: [table.resultId, table.resultRevisionNumber],
      foreignColumns: [
        itemResultRevisionsTable.resultId,
        itemResultRevisionsTable.revisionNumber,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "photos_object_keys_check",
      sql`btrim(${table.originalObjectKey}) <> ''
          AND (
            ${table.previewObjectKey} IS NULL
            OR btrim(${table.previewObjectKey}) <> ''
          )`,
    ),
    check(
      "photos_media_type_check",
      sql`${table.trustedMimeType} IS NULL
          OR ${table.trustedMimeType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "photos_size_check",
      sql`${table.byteSize} IS NULL
          OR ${table.byteSize} BETWEEN 1 AND 10485760`,
    ),
    check(
      "photos_dimensions_check",
      sql`(
            ${table.width} IS NULL
            AND ${table.height} IS NULL
          ) OR (
            ${table.width} IS NOT NULL
            AND ${table.height} IS NOT NULL
            AND ${table.width} BETWEEN 1 AND 8192
            AND ${table.height} BETWEEN 1 AND 8192
            AND ${table.width}::bigint * ${table.height}::bigint <= 20000000
          )`,
    ),
    check(
      "photos_checksum_check",
      sql`${table.checksumSha256} IS NULL
          OR ${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "photos_expiration_check",
      sql`${table.expiresAt} > ${table.reservedAt}`,
    ),
    check(
      "photos_parent_check",
      sql`(
            ${table.status} IN ('reserved', 'expired')
            AND ${table.itemId} IS NULL
            AND ${table.resultId} IS NULL
            AND ${table.resultRevisionNumber} IS NULL
            AND ${table.decisionId} IS NULL
          ) OR (
            ${table.status} NOT IN ('reserved', 'expired')
            AND (
              (
                ${table.purpose} = 'item'
                AND ${table.itemId} IS NOT NULL
                AND ${table.resultId} IS NULL
                AND ${table.resultRevisionNumber} IS NULL
                AND ${table.decisionId} IS NULL
              ) OR (
                ${table.purpose} = 'inspection_result'
                AND ${table.itemId} IS NULL
                AND ${table.resultId} IS NOT NULL
                AND ${table.resultRevisionNumber} IS NOT NULL
                AND ${table.decisionId} IS NULL
              ) OR (
                ${table.purpose} = 'decision_dispute'
                AND ${table.itemId} IS NULL
                AND ${table.resultId} IS NULL
                AND ${table.resultRevisionNumber} IS NULL
                AND ${table.decisionId} IS NOT NULL
              )
            )
          )`,
    ),
    check(
      "photos_attached_metadata_check",
      sql`${table.status} IN ('reserved', 'expired')
          OR (
            ${table.previewObjectKey} IS NOT NULL
            AND ${table.trustedMimeType} IS NOT NULL
            AND ${table.byteSize} IS NOT NULL
            AND ${table.width} IS NOT NULL
            AND ${table.height} IS NOT NULL
            AND ${table.checksumSha256} IS NOT NULL
          )`,
    ),
    check(
      "photos_lifecycle_check",
      sql`(
            ${table.status} = 'reserved'
            AND ${table.attachedAt} IS NULL
            AND ${table.supersededAt} IS NULL
            AND ${table.removedAt} IS NULL
            AND ${table.binaryDeletedAt} IS NULL
          ) OR (
            ${table.status} = 'expired'
            AND ${table.attachedAt} IS NULL
            AND ${table.supersededAt} IS NULL
            AND ${table.removedAt} IS NULL
          ) OR (
            ${table.status} = 'attached'
            AND ${table.attachedAt} IS NOT NULL
            AND ${table.supersededAt} IS NULL
            AND ${table.removedAt} IS NULL
            AND ${table.binaryDeletedAt} IS NULL
          ) OR (
            ${table.status} = 'superseded'
            AND ${table.attachedAt} IS NOT NULL
            AND ${table.supersededAt} IS NOT NULL
            AND ${table.removedAt} IS NULL
            AND ${table.binaryDeletedAt} IS NULL
          ) OR (
            ${table.status} = 'removed'
            AND ${table.attachedAt} IS NOT NULL
            AND ${table.supersededAt} IS NULL
            AND ${table.removedAt} IS NOT NULL
            AND ${table.binaryDeletedAt} IS NULL
          ) OR (
            ${table.status} = 'purged'
            AND ${table.attachedAt} IS NOT NULL
            AND ${table.binaryDeletedAt} IS NOT NULL
            AND num_nonnulls(${table.supersededAt}, ${table.removedAt}) = 1
          )`,
    ),
    check(
      "photos_time_order_check",
      sql`(
            ${table.attachedAt} IS NULL
            OR (
              ${table.attachedAt} >= ${table.reservedAt}
              AND ${table.attachedAt} <= ${table.expiresAt}
            )
          )
          AND (
            ${table.supersededAt} IS NULL
            OR (
              ${table.attachedAt} IS NOT NULL
              AND ${table.supersededAt} >= ${table.attachedAt}
            )
          )
          AND (
            ${table.removedAt} IS NULL
            OR (
              ${table.attachedAt} IS NOT NULL
              AND ${table.removedAt} >= ${table.attachedAt}
            )
          )
          AND (
            ${table.binaryDeletedAt} IS NULL
            OR ${table.binaryDeletedAt} >= coalesce(
              ${table.supersededAt},
              ${table.removedAt},
              ${table.attachedAt},
              ${table.expiresAt}
            )
          )`,
    ),
    check("photos_version_check", sql`${table.version} > 0`),
    index("photos_expiry_status_idx").on(table.status, table.expiresAt),
    index("photos_item_status_idx").on(table.itemId, table.status),
    index("photos_result_status_idx").on(
      table.resultId,
      table.resultRevisionNumber,
      table.status,
    ),
    index("photos_decision_status_idx").on(table.decisionId, table.status),
    index("photos_uploaded_by_status_idx").on(
      table.uploadedBy,
      table.status,
    ),
  ],
);

export const notificationMailboxesTable = inventorySchema.table(
  "notification_mailboxes",
  {
    id: uuid().primaryKey(),
    kind: notificationMailboxKindEnum().notNull(),
    userId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    nextSequence: bigint({ mode: "bigint" })
      .notNull()
      .default(sql`1`),
  },
  (table) => [
    check(
      "notification_mailboxes_owner_check",
      sql`(${table.kind} = 'direct_user' AND ${table.userId} IS NOT NULL)
          OR (${table.kind} = 'admin_queue' AND ${table.userId} IS NULL)`,
    ),
    check(
      "notification_mailboxes_sequence_check",
      sql`${table.nextSequence} > 0`,
    ),
    uniqueIndex("notification_mailboxes_direct_user_unique")
      .on(table.userId)
      .where(sql`${table.kind} = 'direct_user'`),
    uniqueIndex("notification_mailboxes_admin_queue_unique")
      .on(table.kind)
      .where(sql`${table.kind} = 'admin_queue'`),
  ],
);

export const notificationEventsTable = inventorySchema.table(
  "notification_events",
  {
    id: uuid().primaryKey(),
    domainEventId: uuid().notNull(),
    type: notificationEventTypeEnum().notNull(),
    actorId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    subjectKind: notificationSubjectKindEnum().notNull(),
    subjectId: uuid().notNull(),
    subjectRevision: integer().notNull(),
    audienceKind: notificationAudienceKindEnum().notNull(),
    safePayload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    adminQueueSequence: bigint({ mode: "bigint" }),
  },
  (table) => [
    check(
      "notification_events_subject_revision_check",
      sql`${table.subjectRevision} > 0`,
    ),
    check(
      "notification_events_audience_sequence_check",
      sql`(
            ${table.audienceKind} = 'direct_user'
            AND ${table.adminQueueSequence} IS NULL
          ) OR (
            ${table.audienceKind} = 'admin_queue'
            AND ${table.adminQueueSequence} IS NOT NULL
            AND ${table.adminQueueSequence} > 0
          )`,
    ),
    uniqueIndex("notification_events_domain_identity_unique").on(
      table.domainEventId,
      table.type,
      table.subjectKind,
      table.subjectId,
      table.subjectRevision,
      table.audienceKind,
    ),
    index("notification_events_feed_idx").on(
      table.occurredAt,
      table.id,
    ),
    index("notification_events_admin_queue_idx").on(
      table.audienceKind,
      table.adminQueueSequence,
    ),
    uniqueIndex("notification_events_admin_queue_sequence_unique")
      .on(table.adminQueueSequence)
      .where(sql`${table.audienceKind} = 'admin_queue'`),
    index("notification_events_actor_idx").on(table.actorId),
  ],
);

export const notificationDeliveriesTable = inventorySchema.table(
  "notification_deliveries",
  {
    eventId: uuid()
      .notNull()
      .references(() => notificationEventsTable.id, {
        onDelete: "cascade",
        onUpdate: "restrict",
      }),
    recipientId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    mailboxSequence: bigint({ mode: "bigint" }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    readAt: timestamp({ withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({
      name: "notification_deliveries_pk",
      columns: [table.eventId, table.recipientId],
    }),
    check(
      "notification_deliveries_sequence_check",
      sql`${table.mailboxSequence} > 0`,
    ),
    uniqueIndex("notification_deliveries_recipient_sequence_unique").on(
      table.recipientId,
      table.mailboxSequence,
    ),
    index("notification_deliveries_recipient_feed_idx").on(
      table.recipientId,
      table.createdAt,
      table.eventId,
    ),
  ],
);

export const notificationReceiptsTable = inventorySchema.table(
  "notification_receipts",
  {
    eventId: uuid()
      .notNull()
      .references(() => notificationEventsTable.id, {
        onDelete: "cascade",
        onUpdate: "restrict",
      }),
    userId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    readAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "notification_receipts_pk",
      columns: [table.eventId, table.userId],
    }),
    index("notification_receipts_user_read_idx").on(
      table.userId,
      table.readAt,
    ),
  ],
);

export const auditRecordsTable = inventorySchema.table(
  "audit_records",
  {
    id: uuid().primaryKey(),
    domainEventId: uuid(),
    actorId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    actorRoleSnapshot: authRoleEnum(),
    subjectKind: auditSubjectKindEnum().notNull(),
    subjectId: uuid().notNull(),
    subjectRevision: integer(),
    action: varchar({ length: 80 }).notNull(),
    beforeValues: jsonb().$type<Record<string, unknown>>(),
    afterValues: jsonb().$type<Record<string, unknown>>(),
    reason: varchar({ length: 1000 }),
    isAdministrativeException: boolean().notNull().default(false),
    metadata: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "audit_records_actor_snapshot_check",
      sql`(${table.actorId} IS NULL) = (${table.actorRoleSnapshot} IS NULL)`,
    ),
    check(
      "audit_records_action_check",
      sql`btrim(${table.action}) <> ''`,
    ),
    check(
      "audit_records_snapshot_check",
      sql`${table.beforeValues} IS NOT NULL OR ${table.afterValues} IS NOT NULL`,
    ),
    check(
      "audit_records_subject_revision_check",
      sql`${table.subjectRevision} IS NULL OR ${table.subjectRevision} > 0`,
    ),
    check(
      "audit_records_reason_check",
      sql`(
            ${table.reason} IS NULL
            AND ${table.isAdministrativeException} = false
          ) OR (
            ${table.reason} IS NOT NULL
            AND btrim(${table.reason}) <> ''
          )`,
    ),
    index("audit_records_subject_idx").on(
      table.subjectKind,
      table.subjectId,
      table.occurredAt,
    ),
    index("audit_records_actor_idx").on(table.actorId, table.occurredAt),
    index("audit_records_domain_event_idx").on(table.domainEventId),
  ],
);

export const idempotencyRequestsTable = inventorySchema.table(
  "idempotency_requests",
  {
    id: uuid().primaryKey(),
    actorId: uuid()
      .notNull()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    operation: varchar({ length: 80 }).notNull(),
    idempotencyKey: varchar({ length: 128 }).notNull(),
    requestHash: varchar({ length: 64 }).notNull(),
    state: idempotencyStateEnum().notNull().default("processing"),
    responseStatus: integer(),
    responseBody: jsonb().$type<Record<string, unknown>>(),
    resourceId: uuid(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check(
      "idempotency_requests_values_check",
      sql`btrim(${table.operation}) <> ''
          AND btrim(${table.idempotencyKey}) <> ''
          AND ${table.requestHash} ~ '^[0-9a-f]{64}$'
          AND ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "idempotency_requests_state_check",
      sql`(
            ${table.state} = 'processing'
            AND ${table.responseStatus} IS NULL
            AND ${table.responseBody} IS NULL
            AND ${table.completedAt} IS NULL
          ) OR (
            ${table.state} = 'completed'
            AND ${table.responseStatus} BETWEEN 100 AND 599
            AND ${table.responseBody} IS NOT NULL
            AND ${table.completedAt} IS NOT NULL
            AND ${table.completedAt} >= ${table.createdAt}
          )`,
    ),
    uniqueIndex("idempotency_requests_actor_operation_key_unique").on(
      table.actorId,
      table.operation,
      table.idempotencyKey,
    ),
    index("idempotency_requests_expiry_idx").on(table.expiresAt),
  ],
);
