import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";

import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryConcurrencyRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-concurrency-repositories";

let migrationConfig: DatabaseConfig;
let pool: Pool;

describe("inventory domain entities", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({
      purpose: "migration",
      target: "test",
    });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    pool = createPostgresPool(migrationConfig, { max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
    await resetSchemas(migrationConfig);
  });

  it("keeps inspection context and historical snapshots structurally stable", async () => {
    await withRollback(pool, async (client) => {
      const domain = await seedInspectionDomain(client);
      const otherBuildingId = randomUUID();
      const otherRoomId = randomUUID();
      const otherInspectionId = randomUUID();

      await client.query(
        `insert into "yu_inventory"."buildings"
           (id, name, name_key, address, address_key, created_by, updated_by)
         values ($1, 'Building B', 'building b', 'Other address', 'other address', $2, $2)`,
        [otherBuildingId, domain.technicianId],
      );
      await client.query(
        `insert into "yu_inventory"."rooms"
           (id, building_id, designation, designation_key, floor_number,
            created_by, updated_by)
         values ($1, $2, '202', '202', 2, $3, $3)`,
        [otherRoomId, otherBuildingId, domain.technicianId],
      );
      await client.query(
        `insert into "yu_inventory"."inspections"
           (id, name, technician_id, created_by)
         values ($1, 'Other inspection', $2, $2)`,
        [otherInspectionId, domain.technicianId],
      );

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."inspection_rooms"
             (id, inspection_id, building_id, room_id,
              building_name_snapshot, building_address_snapshot,
              room_designation_snapshot, room_floor_number_snapshot,
              added_by)
           values ($1, $2, $3, $4, 'Wrong building', 'Wrong address',
                   '202', 2, $5)`,
          [
            randomUUID(),
            domain.inspectionId,
            domain.buildingId,
            otherRoomId,
            domain.technicianId,
          ],
        ),
        "23503",
      );

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."item_results"
             (id, inspection_id, inspection_room_id, item_id,
              registry_room_id_at_scan, responsible_id_at_scan,
              decision_recipient_kind_at_scan,
              item_name_snapshot, inventory_number_kind_snapshot,
              inventory_number_snapshot, building_name_snapshot,
              room_designation_snapshot, created_by)
           values ($1, $2, $3, $4, $5, $6, 'user', 'Projector',
                   'official', 'INV-1', 'Building A', '101', $7)`,
          [
            randomUUID(),
            otherInspectionId,
            domain.inspectionRoomId,
            domain.itemId,
            domain.roomId,
            domain.employeeId,
            domain.technicianId,
          ],
        ),
        "23503",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."item_result_revisions"
             (result_id, revision_number, result, inspection_room_id,
              observed_room_id, created_by)
           values ($1, 2, 'present', $2, $3, $4)`,
          [
            domain.resultId,
            domain.inspectionRoomId,
            otherRoomId,
            domain.technicianId,
          ],
        ),
        "23503",
      );

      await client.query(
        `update "yu_inventory"."buildings"
         set name = 'Renamed building', name_key = 'renamed building'
         where id = $1`,
        [domain.buildingId],
      );
      await client.query(
        `update "yu_inventory"."rooms"
         set designation = '101A', designation_key = '101a'
         where id = $1`,
        [domain.roomId],
      );
      await client.query(
        `update "yu_inventory"."items"
         set name = 'Renamed projector'
         where id = $1`,
        [domain.itemId],
      );

      const snapshots = await client.query<{
        building_name_snapshot: string;
        item_name_snapshot: string;
        room_designation_snapshot: string;
      }>(
        `select ir.building_name_snapshot,
                ir.room_designation_snapshot,
                iri.item_name_snapshot
         from "yu_inventory"."inspection_rooms" ir
         join "yu_inventory"."inspection_room_items" iri
           on iri.inspection_room_id = ir.id
         where ir.id = $1`,
        [domain.inspectionRoomId],
      );
      expect(snapshots.rows[0]).toEqual({
        building_name_snapshot: "Building A",
        item_name_snapshot: "Projector",
        room_designation_snapshot: "101",
      });

      await expectDatabaseError(
        client,
        () => client.query(
          `delete from "yu_inventory"."rooms" where id = $1`,
          [domain.roomId],
        ),
        "23503",
      );
    });
  });

  it("enforces QR, responsibility, transfer, decision, and photo shapes", async () => {
    await withRollback(pool, async (client) => {
      const domain = await seedInspectionDomain(client);
      const requesterId = randomUUID();
      const requesterSuffix = randomUUID().slice(0, 8);

      await client.query(
        `insert into "yu_inventory"."users"
           (id, code, email, full_name, role, email_verified, is_active,
            created_at, updated_at)
         values ($1, $2, $3, 'Transfer requester', 'employee',
                 true, true, now(), now())`,
        [
          requesterId,
          `REQ-${requesterSuffix}`,
          `requester-${requesterSuffix}@example.com`,
        ],
      );

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."qr_identifiers"
             (id, original_value, canonical_key, format, target_kind,
              role, created_by)
           values ($1, 'legacy', 'legacy', 'legacy_raw', 'building',
                   'alias', $2)`,
          [randomUUID(), domain.technicianId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."item_result_revisions"
             (result_id, revision_number, result, inspection_room_id,
              created_by)
           values ($1, 2, 'present', $2, $3)`,
          [
            domain.resultId,
            domain.inspectionRoomId,
            domain.technicianId,
          ],
        ),
        "23502",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."qr_identifiers"
             (id, original_value, canonical_key, format, target_kind,
              role, building_id, created_by)
           values ($1, 'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                   'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                   'generated_v1', 'building', 'alias', $2, $3)`,
          [randomUUID(), domain.buildingId, domain.technicianId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."deviation_decisions"
             (id, result_id, result_revision_number, recipient_kind,
              recipient_id, created_by)
           values ($1, $2, 1, 'user', $3, $3)`,
          [
            randomUUID(),
            domain.resultId,
            domain.technicianId,
          ],
        ),
        "23503",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."deviation_decisions"
             (id, result_id, result_revision_number, recipient_kind,
              created_by)
           values ($1, $2, 1, 'admin_queue', $3)`,
          [
            randomUUID(),
            domain.resultId,
            domain.technicianId,
          ],
        ),
        "23503",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `update "yu_inventory"."deviation_decisions"
           set status = 'confirmed', acted_at = now()
           where id = $1`,
          [domain.decisionId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `update "yu_inventory"."deviation_decisions"
           set status = 'confirmed', acted_at = now(), acted_by = $2
           where id = $1`,
          [domain.decisionId, domain.technicianId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `update "yu_inventory"."deviation_decisions"
           set status = 'disputed', acted_at = now(), acted_by = $2
           where id = $1`,
          [domain.decisionId, domain.employeeId],
        ),
        "23514",
      );
      const secondResultId = randomUUID();
      const secondItemId = randomUUID();
      await client.query(
        `insert into "yu_inventory"."items"
           (id, name, room_id, inventory_number_kind, inventory_number,
            inventory_number_key, created_by, updated_by)
         values ($1, 'Second projector', $2, 'official', 'INV-2',
                 'inv-2', $3, $3)`,
        [secondItemId, domain.roomId, domain.technicianId],
      );
      await client.query(
        `insert into "yu_inventory"."item_results"
           (id, inspection_id, inspection_room_id, item_id,
            registry_room_id_at_scan, responsible_id_at_scan,
            decision_recipient_kind_at_scan, item_name_snapshot,
            inventory_number_kind_snapshot, inventory_number_snapshot,
            building_name_snapshot, room_designation_snapshot, created_by)
         values ($1, $2, $3, $4, $5, $6, 'user', 'Projector',
                 'official', 'INV-1', 'Building A', '101', $7)`,
        [
          secondResultId,
          domain.inspectionId,
          domain.inspectionRoomId,
          secondItemId,
          domain.roomId,
          domain.employeeId,
          domain.technicianId,
        ],
      );
      await client.query(
        `insert into "yu_inventory"."item_result_revisions"
           (result_id, revision_number, result, inspection_room_id,
            observed_room_id, created_by)
         values ($1, 1, 'broken', $2, $3, $4)`,
        [
          secondResultId,
          domain.inspectionRoomId,
          domain.roomId,
          domain.technicianId,
        ],
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `insert into "yu_inventory"."deviation_decisions"
               (id, result_id, result_revision_number,
                previous_decision_id, recipient_kind, recipient_id,
                created_by)
             values ($1, $2, 1, $3, 'user', $4, $5)`,
            [
              randomUUID(),
              secondResultId,
              domain.decisionId,
              domain.employeeId,
              domain.technicianId,
            ],
          ),
        "23503",
      );
      await client.query(
        `insert into "yu_inventory"."qr_identifiers"
           (id, original_value, canonical_key, format, target_kind,
            role, building_id, created_by)
         values ($1, 'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                 'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                 'generated_v1', 'building', 'primary', $2, $3)`,
        [randomUUID(), domain.buildingId, domain.technicianId],
      );

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."responsibility_periods"
             (id, item_id, responsible_user_id, source, started_at,
              started_by, ended_at, ended_by, end_reason)
           values ($1, $2, $3, 'accepted', now(), $3,
                   now() - interval '1 minute', $3, 'invalid order')`,
          [randomUUID(), domain.itemId, domain.employeeId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."responsibility_periods"
             (id, item_id, responsible_user_id, source, started_by)
           values ($1, $2, $3, 'accepted', $4)`,
          [
            randomUUID(),
            domain.itemId,
            requesterId,
            domain.technicianId,
          ],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."transfers"
             (id, item_id, requested_by, proposed_responsible_id,
              current_responsible_id_at_request)
           values ($1, $2, $3, $4, $3)`,
          [
            randomUUID(),
            domain.itemId,
            domain.technicianId,
            domain.employeeId,
          ],
        ),
        "23514",
      );
      const transferId = randomUUID();
      await client.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [
          transferId,
          domain.itemId,
          requesterId,
          domain.employeeId,
        ],
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `update "yu_inventory"."transfers"
             set status = 'confirmed', closed_at = now(), closed_by = $2
             where id = $1`,
            [transferId, requesterId],
          ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `update "yu_inventory"."transfers"
             set status = 'cancelled', closed_at = now(), closed_by = $2
             where id = $1`,
            [transferId, domain.employeeId],
          ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `update "yu_inventory"."transfers"
             set status = 'rejected', closed_at = now(), closed_by = $2,
                 decision_comment = '   '
             where id = $1`,
            [transferId, domain.employeeId],
          ),
        "23514",
      );
      await client.query(
        `update "yu_inventory"."transfers"
         set status = 'confirmed', closed_at = now(), closed_by = $2
         where id = $1`,
        [transferId, domain.employeeId],
      );
      const overrideTransferId = randomUUID();
      await client.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [
          overrideTransferId,
          domain.itemId,
          requesterId,
          domain.employeeId,
        ],
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `update "yu_inventory"."transfers"
             set status = 'overridden', closed_at = now(), closed_by = $2,
                 override_outcome = 'assigned',
                 override_responsible_id = $3
             where id = $1`,
            [
              overrideTransferId,
              domain.technicianId,
              requesterId,
            ],
          ),
        "23514",
      );
      await client.query(
        `update "yu_inventory"."transfers"
         set status = 'overridden', closed_at = now(), closed_by = $2,
             administrative_reason = 'Emergency reassignment',
             override_outcome = 'assigned',
             override_responsible_id = $3
         where id = $1`,
        [
          overrideTransferId,
          domain.technicianId,
          requesterId,
        ],
      );
      const releaseTransferId = randomUUID();
      await client.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [
          releaseTransferId,
          domain.itemId,
          requesterId,
          domain.employeeId,
        ],
      );
      await expectDatabaseError(
        client,
        () =>
          client.query(
            `update "yu_inventory"."transfers"
             set status = 'overridden', closed_at = now(), closed_by = $2,
                 administrative_reason = 'Incomplete override'
             where id = $1`,
            [releaseTransferId, domain.technicianId],
          ),
        "23514",
      );
      await client.query(
        `update "yu_inventory"."transfers"
         set status = 'overridden', closed_at = now(), closed_by = $2,
             administrative_reason = 'Release unassigned item',
             override_outcome = 'released'
         where id = $1`,
        [releaseTransferId, domain.technicianId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `update "yu_inventory"."deviation_decisions"
           set administrative_reason = 'Not an administrative resolution'
           where id = $1`,
          [domain.decisionId],
        ),
        "23514",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."deviation_decisions"
             (id, result_id, result_revision_number, recipient_kind,
              status, created_by)
           values ($1, $2, 1, 'user', 'pending', $3)`,
          [randomUUID(), domain.resultId, domain.technicianId],
        ),
        "23514",
      );

      await client.query(
        `insert into "yu_inventory"."photos"
           (id, purpose, uploaded_by, original_object_key, expires_at)
         values ($1, 'item', $2, 'uploads/reserved-original',
                 now() + interval '30 minutes')`,
        [randomUUID(), domain.technicianId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."photos"
             (id, purpose, status, uploaded_by, original_object_key,
              preview_object_key, trusted_mime_type, byte_size, width,
              height, checksum_sha256, expires_at, attached_at,
              item_id, result_id)
           values ($1, 'item', 'attached', $2, 'uploads/original',
                   'uploads/preview', 'image/jpeg', 1024, 100, 100,
                   repeat('a', 64), now() + interval '30 minutes',
                   now(), $3, $4)`,
          [
            randomUUID(),
            domain.technicianId,
            domain.itemId,
            domain.resultId,
          ],
        ),
        "23514",
      );
      await client.query(
        `insert into "yu_inventory"."photos"
           (id, purpose, status, uploaded_by, original_object_key,
            preview_object_key, trusted_mime_type, byte_size, width,
            height, checksum_sha256, expires_at, attached_at, item_id)
         values ($1, 'item', 'attached', $2, 'uploads/original',
                 'uploads/preview', 'image/jpeg', 1024, 100, 100,
                 repeat('a', 64), now() + interval '30 minutes',
                 now(), $3)`,
        [randomUUID(), domain.technicianId, domain.itemId],
      );
      await client.query(
        `insert into "yu_inventory"."photos"
           (id, purpose, status, uploaded_by, original_object_key,
            preview_object_key, trusted_mime_type, byte_size, width,
            height, checksum_sha256, expires_at, attached_at, result_id,
            result_revision_number)
         values ($1, 'inspection_result', 'attached', $2,
                 'uploads/result-original', 'uploads/result-preview',
                 'image/webp', 2048, 200, 100, repeat('b', 64),
                 now() + interval '30 minutes', now(), $3, 1)`,
        [randomUUID(), domain.technicianId, domain.resultId],
      );
    });
  });

  it("models direct and shared notifications and limits mutable audit access", async () => {
    await withRollback(pool, async (client) => {
      const domain = await seedInspectionDomain(client);
      const directMailboxId = randomUUID();
      const adminMailboxId = randomUUID();
      const eventId = randomUUID();

      await client.query(
        `insert into "yu_inventory"."notification_mailboxes"
           (id, kind, user_id)
         values ($1, 'direct_user', $2), ($3, 'admin_queue', null)`,
        [directMailboxId, domain.employeeId, adminMailboxId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."notification_mailboxes"
             (id, kind, user_id)
           values ($1, 'admin_queue', $2)`,
          [randomUUID(), domain.employeeId],
        ),
        "23514",
      );

      await client.query(
        `insert into "yu_inventory"."notification_events"
           (id, domain_event_id, type, actor_id, subject_kind,
            subject_id, subject_revision, audience_kind, safe_payload,
            occurred_at)
         values ($1, $2, 'decision.created', $3, 'decision',
                 $4, 1, 'direct_user', $5, now())`,
        [
          eventId,
          randomUUID(),
          domain.technicianId,
          domain.decisionId,
          { itemId: domain.itemId },
        ],
      );
      await client.query(
        `insert into "yu_inventory"."notification_deliveries"
           (event_id, recipient_id, mailbox_sequence)
         values ($1, $2, 1)`,
        [eventId, domain.employeeId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."notification_events"
             (id, domain_event_id, type, subject_kind, subject_id,
              subject_revision, audience_kind, safe_payload,
              occurred_at, admin_queue_sequence)
           values ($1, $2, 'inspection.confirmed', 'inspection', $3,
                   1, 'direct_user', '{}', now(), 2)`,
          [randomUUID(), randomUUID(), domain.inspectionId],
        ),
        "23514",
      );

      await client.query(
        `delete from "yu_inventory"."notification_events" where id = $1`,
        [eventId],
      );
      const deliveryCount = await client.query<{ count: number }>(
        `select count(*)::int as count
         from "yu_inventory"."notification_deliveries"
         where event_id = $1`,
        [eventId],
      );
      expect(deliveryCount.rows[0]?.count).toBe(0);

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."audit_records"
             (id, actor_id, actor_role_snapshot, subject_kind,
              subject_id, action)
           values ($1, $2, 'warehouse', 'item', $3, 'item.updated')`,
          [randomUUID(), domain.technicianId, domain.itemId],
        ),
        "23514",
      );
      await client.query(
        `insert into "yu_inventory"."audit_records"
           (id, actor_id, actor_role_snapshot, subject_kind,
            subject_id, action, before_values, after_values)
         values ($1, $2, 'warehouse', 'item', $3, 'item.updated',
                 $4, $5)`,
        [
          randomUUID(),
          domain.technicianId,
          domain.itemId,
          { name: "Projector" },
          { name: "Renamed projector" },
        ],
      );
    });
  });

  it("enforces uniqueness, idempotency, versions, and append-only audit", async () => {
    await withRollback(pool, async (client) => {
      const domain = await seedInspectionDomain(client);
      const primaryQrId = randomUUID();

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."items"
             (id, name, room_id, inventory_number_kind, inventory_number,
              inventory_number_key, created_by, updated_by)
           values ($1, 'Duplicate number', $2, 'official', 'INV-1',
                   'inv-1', $3, $3)`,
          [randomUUID(), domain.roomId, domain.technicianId],
        ),
        "23505",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."item_results"
             (id, inspection_id, inspection_room_id, item_id,
              registry_room_id_at_scan, responsible_id_at_scan,
              decision_recipient_kind_at_scan, item_name_snapshot,
              inventory_number_kind_snapshot, inventory_number_snapshot,
              building_name_snapshot, room_designation_snapshot, created_by)
           values ($1, $2, $3, $4, $5, $6, 'user', 'Projector',
                   'official', 'INV-1', 'Building A', '101', $7)`,
          [
            randomUUID(),
            domain.inspectionId,
            domain.inspectionRoomId,
            domain.itemId,
            domain.roomId,
            domain.employeeId,
            domain.technicianId,
          ],
        ),
        "23505",
      );

      await client.query(
        `insert into "yu_inventory"."qr_identifiers"
           (id, original_value, canonical_key, format, target_kind,
            role, building_id, created_by)
         values ($1, 'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                 'YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ',
                 'generated_v1', 'building', 'primary', $2, $3)`,
        [primaryQrId, domain.buildingId, domain.technicianId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."qr_identifiers"
             (id, original_value, canonical_key, format, target_kind,
              role, item_id, created_by)
           values ($1, 'duplicate', $2, 'legacy_raw', 'item', 'alias',
                   $3, $4)`,
          [
            randomUUID(),
            "YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ",
            domain.itemId,
            domain.technicianId,
          ],
        ),
        "23505",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."qr_identifiers"
             (id, original_value, canonical_key, format, target_kind,
              role, building_id, created_by)
           values ($1, 'SECOND-PRIMARY', 'second-primary', 'legacy_raw',
                   'building', 'primary', $2, $3)`,
          [randomUUID(), domain.buildingId, domain.technicianId],
        ),
        "23505",
      );

      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."responsibility_periods"
             (id, item_id, responsible_user_id, source, started_by)
           values ($1, $2, $3, 'transfer', $4)`,
          [
            randomUUID(),
            domain.itemId,
            domain.technicianId,
            domain.technicianId,
          ],
        ),
        "23505",
      );

      await client.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [
          randomUUID(),
          domain.itemId,
          domain.technicianId,
          domain.employeeId,
        ],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."transfers"
             (id, item_id, requested_by, proposed_responsible_id,
              current_responsible_id_at_request)
           values ($1, $2, $3, $3, $4)`,
          [
            randomUUID(),
            domain.itemId,
            domain.technicianId,
            domain.employeeId,
          ],
        ),
        "23505",
      );

      const concurrency = createPostgresInventoryConcurrencyRepositories(client);
      const idempotencyId = randomUUID();
      const request = {
        id: idempotencyId,
        actorId: domain.employeeId,
        operation: "responsibility.accept",
        key: "mobile-request-1",
        requestHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      };
      await expect(concurrency.idempotency.reserve(request)).resolves.toEqual({
        kind: "reserved",
        id: idempotencyId,
      });
      await expect(concurrency.idempotency.reserve({ ...request, id: randomUUID() })).resolves.toEqual({
        kind: "in_progress",
      });
      await concurrency.idempotency.complete(
        idempotencyId,
        { status: 201, body: { id: "item-1" }, resourceId: domain.itemId },
        new Date(),
      );
      await expect(concurrency.idempotency.reserve({ ...request, id: randomUUID() })).resolves.toEqual({
        kind: "replay",
        response: { status: 201, body: { id: "item-1" }, resourceId: domain.itemId },
      });
      await expect(concurrency.idempotency.reserve({
        ...request,
        id: randomUUID(),
        requestHash: "b".repeat(64),
      })).resolves.toEqual({ kind: "key_reused" });
      await client.query(
        `update "yu_inventory"."idempotency_requests"
         set created_at = created_at - interval '2 seconds',
             expires_at = now() - interval '1 second'
         where id = $1`,
        [idempotencyId],
      );
      const replacementId = randomUUID();
      await expect(concurrency.idempotency.reserve({
        ...request,
        id: replacementId,
        requestHash: "c".repeat(64),
      })).resolves.toEqual({ kind: "reserved", id: replacementId });

      const auditId = randomUUID();
      await expectDatabaseError(
        client,
        () => client.query(
          `insert into "yu_inventory"."audit_records"
             (id, actor_id, actor_role_snapshot, subject_kind,
              subject_id, action, after_values,
              is_administrative_exception)
           values ($1, $2, 'admin', 'item', $3, 'item.override',
                   '{"status":"maintenance"}', true)`,
          [auditId, domain.technicianId, domain.itemId],
        ),
        "23514",
      );
      await client.query(
        `insert into "yu_inventory"."audit_records"
           (id, actor_id, actor_role_snapshot, subject_kind,
            subject_id, action, after_values, reason,
            is_administrative_exception)
         values ($1, $2, 'admin', 'item', $3, 'item.override',
                 '{"status":"maintenance"}', 'Safety exception', true)`,
        [auditId, domain.technicianId, domain.itemId],
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `update "yu_inventory"."audit_records"
           set reason = 'Changed later'
           where id = $1`,
          [auditId],
        ),
        "55000",
      );
      await expectDatabaseError(
        client,
        () => client.query(
          `delete from "yu_inventory"."audit_records" where id = $1`,
          [auditId],
        ),
        "55000",
      );

      const versions = await client.query<{
        building_version: number;
        decision_version: number;
        inspection_version: number;
        item_version: number;
      }>(
        `select b.version as building_version,
                d.version as decision_version,
                i.version as inspection_version,
                it.version as item_version
         from "yu_inventory"."buildings" b
         join "yu_inventory"."inspections" i on i.id = $2
         join "yu_inventory"."items" it on it.id = $3
         join "yu_inventory"."deviation_decisions" d on d.id = $4
         where b.id = $1`,
        [
          domain.buildingId,
          domain.inspectionId,
          domain.itemId,
          domain.decisionId,
        ],
      );
      expect(versions.rows[0]).toEqual({
        building_version: 1,
        decision_version: 1,
        inspection_version: 1,
        item_version: 1,
      });
      await expect(concurrency.versions.advanceVersion({
        record: "item",
        id: domain.itemId,
        expectedVersion: 1,
      })).resolves.toBe(2);
      await expect(concurrency.versions.advanceVersion({
        record: "item",
        id: domain.itemId,
        expectedVersion: 1,
      })).resolves.toBeNull();
    });
  });

  it("keeps inspection ownership separate from per-item acceptance", async () => {
    await withRollback(pool, async (client) => {
      const domain = await seedInspectionDomain(client);
      const unassignedItemId = randomUUID();

      const assigned = await client.query<{
        responsible_user_id: string;
        technician_id: string;
      }>(
        `select i.technician_id, rp.responsible_user_id
         from "yu_inventory"."inspections" i
         join "yu_inventory"."responsibility_periods" rp
           on rp.item_id = $2 and rp.ended_at is null
         where i.id = $1`,
        [domain.inspectionId, domain.itemId],
      );
      expect(assigned.rows[0]).toEqual({
        responsible_user_id: domain.employeeId,
        technician_id: domain.technicianId,
      });

      await client.query(
        `insert into "yu_inventory"."items"
           (id, name, room_id, inventory_number_kind, inventory_number,
            inventory_number_key, created_by, updated_by)
         values ($1, 'Unassigned monitor', $2, 'temporary',
                 'TMP-2026-999999', 'tmp-2026-999999', $3, $3)`,
        [unassignedItemId, domain.roomId, domain.technicianId],
      );
      const beforeAcceptance = await client.query<{ count: number }>(
        `select count(*)::int as count
         from "yu_inventory"."responsibility_periods"
         where item_id = $1 and ended_at is null`,
        [unassignedItemId],
      );
      expect(beforeAcceptance.rows[0]?.count).toBe(0);

      await client.query(
        `insert into "yu_inventory"."responsibility_periods"
           (id, item_id, responsible_user_id, source, started_by)
         values ($1, $2, $3, 'accepted', $3)`,
        [randomUUID(), unassignedItemId, domain.employeeId],
      );
      const afterAcceptance = await client.query<{
        responsible_user_id: string;
      }>(
        `select responsible_user_id
         from "yu_inventory"."responsibility_periods"
         where item_id = $1 and ended_at is null`,
        [unassignedItemId],
      );
      expect(afterAcceptance.rows).toEqual([
        { responsible_user_id: domain.employeeId },
      ]);
    });
  });

  it("serializes concurrent compare-and-swap and idempotency reservations", async () => {
    const setupClient = await pool.connect();
    let domain: SeededInspectionDomain;
    try {
      await setupClient.query("begin");
      domain = await seedInspectionDomain(setupClient);
      await setupClient.query("commit");
    } finally {
      setupClient.release();
    }

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const firstRepositories = createPostgresInventoryConcurrencyRepositories(first);
      const secondRepositories = createPostgresInventoryConcurrencyRepositories(second);
      const request = {
        id: randomUUID(),
        actorId: domain.employeeId,
        operation: "item.update",
        key: `concurrent-${randomUUID()}`,
        requestHash: "d".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      };

      await first.query("begin");
      await second.query("begin");
      await expect(firstRepositories.idempotency.reserve(request)).resolves.toEqual({
        kind: "reserved",
        id: request.id,
      });
      const duplicateReservation = secondRepositories.idempotency.reserve({
        ...request,
        id: randomUUID(),
      });
      await firstRepositories.idempotency.complete(
        request.id,
        { status: 200, body: { id: domain.itemId }, resourceId: domain.itemId },
        new Date(),
      );
      await first.query("commit");
      await expect(duplicateReservation).resolves.toEqual({
        kind: "replay",
        response: { status: 200, body: { id: domain.itemId }, resourceId: domain.itemId },
      });
      await second.query("commit");

      await first.query("begin");
      await second.query("begin");
      await expect(firstRepositories.versions.advanceVersion({
        record: "item",
        id: domain.itemId,
        expectedVersion: 1,
      })).resolves.toBe(2);
      const staleAdvance = secondRepositories.versions.advanceVersion({
        record: "item",
        id: domain.itemId,
        expectedVersion: 1,
      });
      await first.query("commit");
      await expect(staleAdvance).resolves.toBeNull();
      await second.query("commit");
    } finally {
      await first.query("rollback").catch(() => undefined);
      await second.query("rollback").catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it("creates the database uniqueness guards used for concurrent writes", async () => {
    const indexes = await pool.query<{
      indexdef: string;
      indexname: string;
      tablename: string;
    }>(
      `select tablename, indexname, indexdef
       from pg_indexes
       where schemaname = 'yu_inventory'`,
    );
    const uniqueDefinitionsFor = (tableName: string) =>
      indexes.rows
        .filter(
          (row) =>
            row.tablename === tableName &&
            row.indexdef.includes(" UNIQUE "),
        )
        .map((row) => row.indexdef.replaceAll('"', ""))
        .join("\n");

    expect(uniqueDefinitionsFor("qr_identifiers")).toContain(
      "(canonical_key)",
    );
    expect(uniqueDefinitionsFor("items")).toContain(
      "(inventory_number_key)",
    );
    expect(uniqueDefinitionsFor("transfers")).toMatch(/\(item_id\)/);
    expect(uniqueDefinitionsFor("item_results")).toContain(
      "(inspection_id, item_id)",
    );
  });
});

interface SeededInspectionDomain {
  buildingId: string;
  decisionId: string;
  employeeId: string;
  inspectionId: string;
  inspectionRoomId: string;
  itemId: string;
  resultId: string;
  roomId: string;
  technicianId: string;
}

async function seedInspectionDomain(
  client: PoolClient,
): Promise<SeededInspectionDomain> {
  const technicianId = randomUUID();
  const employeeId = randomUUID();
  const buildingId = randomUUID();
  const roomId = randomUUID();
  const inspectionId = randomUUID();
  const inspectionRoomId = randomUUID();
  const itemId = randomUUID();
  const resultId = randomUUID();
  const decisionId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await client.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, email_verified, is_active,
        created_at, updated_at)
     values
       ($1, $2, $3, 'Technician', 'warehouse', true, true, now(), now()),
       ($4, $5, $6, 'Employee', 'employee', true, true, now(), now())`,
    [
      technicianId,
      `TECH-${suffix}`,
      `tech-${suffix}@example.com`,
      employeeId,
      `EMP-${suffix}`,
      `employee-${suffix}@example.com`,
    ],
  );
  await client.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Building A', 'building a', 'Main address',
             'main address', $2, $2)`,
    [buildingId, technicianId],
  );
  await client.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, '101', '101', 1, $3, $3)`,
    [roomId, buildingId, technicianId],
  );
  await client.query(
    `insert into "yu_inventory"."inspections"
       (id, name, technician_id, created_by)
     values ($1, 'July inspection', $2, $2)`,
    [inspectionId, technicianId],
  );
  await client.query(
    `insert into "yu_inventory"."items"
       (id, name, room_id, inventory_number_kind, inventory_number,
        inventory_number_key, created_by, updated_by)
     values ($1, 'Projector', $2, 'official', 'INV-1', 'inv-1', $3, $3)`,
    [itemId, roomId, technicianId],
  );
  await client.query(
    `insert into "yu_inventory"."responsibility_periods"
       (id, item_id, responsible_user_id, source, started_by)
     values ($1, $2, $3, 'accepted', $3)`,
    [randomUUID(), itemId, employeeId],
  );
  await client.query(
    `insert into "yu_inventory"."inspection_rooms"
       (id, inspection_id, building_id, room_id,
        building_name_snapshot, building_address_snapshot,
        room_designation_snapshot, room_floor_number_snapshot, added_by)
     values ($1, $2, $3, $4, 'Building A', 'Main address', '101', 1, $5)`,
    [
      inspectionRoomId,
      inspectionId,
      buildingId,
      roomId,
      technicianId,
    ],
  );
  await client.query(
    `insert into "yu_inventory"."inspection_room_items"
       (inspection_room_id, item_id, registry_room_id,
        responsible_user_id, item_name_snapshot,
        inventory_number_kind_snapshot, inventory_number_snapshot,
        building_name_snapshot, room_designation_snapshot)
     values ($1, $2, $3, $4, 'Projector', 'official', 'INV-1',
             'Building A', '101')`,
    [inspectionRoomId, itemId, roomId, employeeId],
  );
  await client.query(
    `insert into "yu_inventory"."item_results"
       (id, inspection_id, inspection_room_id, item_id,
        registry_room_id_at_scan, responsible_id_at_scan,
        decision_recipient_kind_at_scan,
        item_name_snapshot, inventory_number_kind_snapshot,
        inventory_number_snapshot, building_name_snapshot,
        room_designation_snapshot, created_by)
     values ($1, $2, $3, $4, $5, $6, 'user', 'Projector',
             'official', 'INV-1', 'Building A', '101', $7)`,
    [
      resultId,
      inspectionId,
      inspectionRoomId,
      itemId,
      roomId,
      employeeId,
      technicianId,
    ],
  );
  await client.query(
    `insert into "yu_inventory"."item_result_revisions"
       (result_id, revision_number, result, inspection_room_id,
        observed_room_id, created_by)
     values ($1, 1, 'missing', $2, $3, $4)`,
    [resultId, inspectionRoomId, roomId, technicianId],
  );
  await client.query(
    `insert into "yu_inventory"."deviation_decisions"
       (id, result_id, result_revision_number, recipient_kind,
        recipient_id, created_by)
     values ($1, $2, 1, 'user', $3, $4)`,
    [decisionId, resultId, employeeId, technicianId],
  );

  return {
    buildingId,
    decisionId,
    employeeId,
    inspectionId,
    inspectionRoomId,
    itemId,
    resultId,
    roomId,
    technicianId,
  };
}

async function expectDatabaseError(
  client: PoolClient,
  operation: () => Promise<QueryResult>,
  code: string,
) {
  await client.query("savepoint constraint_probe");
  try {
    await expect(operation()).rejects.toMatchObject({ code });
  } finally {
    await client.query("rollback to savepoint constraint_probe");
    await client.query("release savepoint constraint_probe");
  }
}

async function withRollback(
  database: Pool,
  operation: (client: PoolClient) => Promise<void>,
) {
  const client = await database.connect();
  try {
    await client.query("begin");
    await operation(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
