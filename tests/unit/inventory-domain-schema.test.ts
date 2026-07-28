import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

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
import {
  auditRecordsTable,
  auditSubjectKindEnum,
  buildingsTable,
  decisionRecipientKindEnum,
  decisionResolutionEnum,
  decisionStatusEnum,
  deviationDecisionsTable,
  idempotencyRequestsTable,
  idempotencyStateEnum,
  inspectionRoomItemsTable,
  inspectionRoomsTable,
  inspectionsTable,
  inspectionStatusEnum,
  inventoryNumberKindEnum,
  itemInventoryNumberHistoryTable,
  itemResultRevisionsTable,
  itemResultsTable,
  itemsTable,
  itemResultValueEnum,
  itemStatusEnum,
  notificationAudienceKindEnum,
  notificationDeliveriesTable,
  notificationEventsTable,
  notificationEventTypeEnum,
  notificationMailboxKindEnum,
  notificationMailboxesTable,
  notificationReceiptsTable,
  notificationSubjectKindEnum,
  photoPurposeEnum,
  photosTable,
  photoStatusEnum,
  qrFormatEnum,
  qrIdentifiersTable,
  qrRoleEnum,
  qrStatusEnum,
  qrTargetKindEnum,
  recordStatusEnum,
  responsibilityPeriodsTable,
  responsibilitySourceEnum,
  roomsTable,
  transfersTable,
  transferOverrideOutcomeEnum,
  transferStatusEnum,
} from "@/lib/db/schema";

describe("inventory domain schema declarations", () => {
  it("declares every core entity and the history needed to preserve evidence", () => {
    const tables = [
      buildingsTable,
      roomsTable,
      itemsTable,
      itemInventoryNumberHistoryTable,
      qrIdentifiersTable,
      photosTable,
      responsibilityPeriodsTable,
      transfersTable,
      inspectionsTable,
      inspectionRoomsTable,
      inspectionRoomItemsTable,
      itemResultsTable,
      itemResultRevisionsTable,
      deviationDecisionsTable,
      notificationMailboxesTable,
      notificationEventsTable,
      notificationDeliveriesTable,
      notificationReceiptsTable,
      auditRecordsTable,
      idempotencyRequestsTable,
    ];

    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "buildings",
      "rooms",
      "items",
      "item_inventory_number_history",
      "qr_identifiers",
      "photos",
      "responsibility_periods",
      "transfers",
      "inspections",
      "inspection_rooms",
      "inspection_room_items",
      "item_results",
      "item_result_revisions",
      "deviation_decisions",
      "notification_mailboxes",
      "notification_events",
      "notification_deliveries",
      "notification_receipts",
      "audit_records",
      "idempotency_requests",
    ]);
  });

  it("keeps database enums aligned with the shared domain vocabulary", () => {
    expect(recordStatusEnum.enumValues).toEqual(RECORD_STATUSES);
    expect(itemStatusEnum.enumValues).toEqual(ITEM_STATUSES);
    expect(inventoryNumberKindEnum.enumValues).toEqual(
      INVENTORY_NUMBER_KINDS,
    );
    expect(qrFormatEnum.enumValues).toEqual(QR_FORMATS);
    expect(qrTargetKindEnum.enumValues).toEqual(QR_TARGET_KINDS);
    expect(qrRoleEnum.enumValues).toEqual(QR_ROLES);
    expect(qrStatusEnum.enumValues).toEqual(QR_STATUSES);
    expect(photoPurposeEnum.enumValues).toEqual(PHOTO_PURPOSES);
    expect(photoStatusEnum.enumValues).toEqual(PHOTO_STATUSES);
    expect(responsibilitySourceEnum.enumValues).toEqual(
      RESPONSIBILITY_SOURCES,
    );
    expect(transferStatusEnum.enumValues).toEqual(TRANSFER_STATUSES);
    expect(transferOverrideOutcomeEnum.enumValues).toEqual(
      TRANSFER_OVERRIDE_OUTCOMES,
    );
    expect(inspectionStatusEnum.enumValues).toEqual(INSPECTION_STATUSES);
    expect(itemResultValueEnum.enumValues).toEqual(ITEM_RESULT_VALUES);
    expect(decisionRecipientKindEnum.enumValues).toEqual(
      DECISION_RECIPIENT_KINDS,
    );
    expect(decisionStatusEnum.enumValues).toEqual(DECISION_STATUSES);
    expect(decisionResolutionEnum.enumValues).toEqual(
      DECISION_RESOLUTIONS,
    );
    expect(notificationEventTypeEnum.enumValues).toEqual(
      NOTIFICATION_EVENT_TYPES,
    );
    expect(notificationSubjectKindEnum.enumValues).toEqual(
      NOTIFICATION_SUBJECT_KINDS,
    );
    expect(notificationAudienceKindEnum.enumValues).toEqual(
      NOTIFICATION_AUDIENCE_KINDS,
    );
    expect(notificationMailboxKindEnum.enumValues).toEqual(
      NOTIFICATION_MAILBOX_KINDS,
    );
    expect(auditSubjectKindEnum.enumValues).toEqual(AUDIT_SUBJECT_KINDS);
    expect(idempotencyStateEnum.enumValues).toEqual(IDEMPOTENCY_STATES);
  });

  it("uses composite context keys for snapshots and result revisions", () => {
    const inspectionRoom = getTableConfig(inspectionRoomsTable);
    const baselineItem = getTableConfig(inspectionRoomItemsTable);
    const result = getTableConfig(itemResultsTable);
    const resultRevision = getTableConfig(itemResultRevisionsTable);
    const decision = getTableConfig(deviationDecisionsTable);
    const photo = getTableConfig(photosTable);
    const responsibility = getTableConfig(responsibilityPeriodsTable);
    const transfer = getTableConfig(transfersTable);

    expect(
      inspectionRoom.uniqueConstraints.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        "inspection_rooms_inspection_room_unique",
        "inspection_rooms_id_inspection_unique",
        "inspection_rooms_id_room_unique",
      ]),
    );
    expect(baselineItem.foreignKeys.map((key) => key.getName())).toContain(
      "inspection_room_items_room_context_fk",
    );
    expect(result.foreignKeys.map((key) => key.getName())).toContain(
      "item_results_inspection_room_context_fk",
    );
    expect(decision.foreignKeys.map((key) => key.getName())).toContain(
      "deviation_decisions_result_revision_fk",
    );
    expect(decision.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        "deviation_decisions_previous_result_fk",
        "deviation_decisions_recipient_kind_snapshot_fk",
        "deviation_decisions_recipient_user_snapshot_fk",
      ]),
    );
    expect(resultRevision.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        "item_result_revisions_result_context_fk",
        "item_result_revisions_observed_room_context_fk",
      ]),
    );
    expect(photo.foreignKeys.map((key) => key.getName())).toContain(
      "photos_result_revision_fk",
    );
    expect(
      resultRevision.columns.find(
        (column) => column === itemResultRevisionsTable.observedRoomId,
      )?.notNull,
    ).toBe(true);
    expect(
      responsibility.checks.map((constraint) => constraint.name),
    ).toContain("responsibility_periods_acceptance_actor_check");
    expect(transfer.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "transfers_closure_actor_check",
        "transfers_decision_comment_check",
        "transfers_override_state_check",
      ]),
    );
  });

  it("declares concurrency, idempotency, and global uniqueness guards", () => {
    const versionedTables = [
      buildingsTable,
      roomsTable,
      itemsTable,
      inspectionsTable,
      qrIdentifiersTable,
      transfersTable,
      deviationDecisionsTable,
      photosTable,
    ];

    for (const table of versionedTables) {
      const version = getTableConfig(table).columns.find(
        (column) => column.name === "version",
      );
      expect(version?.notNull).toBe(true);
      expect(version?.hasDefault).toBe(true);
    }

    expect(indexNames(itemsTable)).toContain(
      "items_inventory_number_key_unique",
    );
    expect(indexNames(qrIdentifiersTable)).toEqual(
      expect.arrayContaining([
        "qr_identifiers_canonical_key_unique",
        "qr_identifiers_active_primary_building_unique",
        "qr_identifiers_active_primary_room_unique",
        "qr_identifiers_active_primary_item_unique",
      ]),
    );
    expect(indexNames(responsibilityPeriodsTable)).toContain(
      "responsibility_periods_open_item_unique",
    );
    expect(indexNames(transfersTable)).toContain(
      "transfers_pending_item_unique",
    );
    expect(indexNames(itemResultsTable)).toContain(
      "item_results_inspection_item_unique",
    );
    expect(indexNames(idempotencyRequestsTable)).toContain(
      "idempotency_requests_actor_operation_key_unique",
    );
  });
});

function indexNames(
  table: Parameters<typeof getTableConfig>[0],
): string[] {
  return getTableConfig(table)
    .indexes
    .map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}
