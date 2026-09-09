import { readFile } from "node:fs/promises";
import pg from "pg";

if (process.env.CAPACITY_ALLOW_DISPOSABLE_SEED !== "1") {
  throw new Error("Refusing to seed: CAPACITY_ALLOW_DISPOSABLE_SEED=1 is required.");
}
if (!/^capacity-local-/.test(process.env.TEST_DATABASE_DEPLOYMENT_ID ?? "")) {
  throw new Error("Refusing to seed a database not identified as capacity-local-*.");
}
const connectionString = process.env.TEST_DATABASE_MIGRATOR_URL;
if (!connectionString) throw new Error("TEST_DATABASE_MIGRATOR_URL is required.");
const parsed = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
  throw new Error("Disposable capacity seed only supports a loopback PostgreSQL host.");
}

const dataset = JSON.parse(await readFile(new URL("./dataset-v1.json", import.meta.url), "utf8"));
const c = dataset.cardinality;
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("select set_config('yu_capacity.epoch', $1, false)", [dataset.epoch]);
  await client.query("begin");
  await client.query(`
    insert into yu_inventory.one_c_fixed_asset_inbox
      (external_id, payload_hash, payload, received_at, updated_at)
    select 'capacity-1c-' || g, repeat('b', 64),
           jsonb_build_object('synthetic', true, 'ordinal', g),
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.oneCInbox]);
  await client.query(`
    insert into yu_inventory.users
      (id, code, email, full_name, iin, org_unit, position, role, email_verified, is_active, version, created_at, updated_at)
    select md5('capacity:user:' || g)::uuid, 'CAP-' || lpad(g::text, 6, '0'),
           'capacity-' || g || '@example.invalid', 'Synthetic User ' || g,
           lpad(g::text, 12, '0'), 'Synthetic Unit ' || (g % 50), 'Synthetic Position',
           case when g = 1 then 'admin'::yu_inventory.auth_role else 'employee'::yu_inventory.auth_role end,
           true, true, 1, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.users]);
  await client.query(`
    insert into yu_inventory.buildings
      (id, name, name_key, address, address_key, created_by, updated_by)
    select md5('capacity:building:' || g)::uuid, 'Synthetic Building ' || g,
           'synthetic building ' || g, 'Synthetic Address ' || g, 'synthetic address ' || g,
           md5('capacity:user:1')::uuid, md5('capacity:user:1')::uuid
      from generate_series(1, $1::int) g`, [c.buildings]);
  await client.query(`
    insert into yu_inventory.rooms
      (id, building_id, designation, designation_key, floor_number, primary_responsible_id, created_by, updated_by)
    select md5('capacity:room:' || g)::uuid,
           md5('capacity:building:' || (((g - 1) % $2::int) + 1))::uuid,
           'R-' || lpad(g::text, 4, '0'), 'r-' || lpad(g::text, 4, '0'), g % 10,
           md5('capacity:user:' || (((g - 1) % $3::int) + 1))::uuid,
           md5('capacity:user:1')::uuid, md5('capacity:user:1')::uuid
      from generate_series(1, $1::int) g`, [c.rooms, c.buildings, c.users]);
  await client.query(`
    insert into yu_inventory.items
      (id, name, description, item_type, brand, model, quantity, unit_price, room_id,
       inventory_number_kind, inventory_number, inventory_number_key, status, condition,
       connection_status, created_by, updated_by, created_at, updated_at)
    select md5('capacity:item:' || g)::uuid, 'Synthetic Asset ' || g, 'Synthetic capacity record',
           case when g % 3 = 0 then 'furniture' when g % 3 = 1 then 'electronics' else 'electrical_equipment' end,
           'Synthetic Brand', 'Model ' || (g % 100), (g % 5) + 1, ((g % 10000) + 100)::numeric,
           md5('capacity:room:' || (((g - 1) % $2::int) + 1))::uuid,
           'official', 'CAP-INV-' || lpad(g::text, 8, '0'), 'cap-inv-' || lpad(g::text, 8, '0'),
           'active', 'good', 'not_applicable', md5('capacity:user:1')::uuid,
           md5('capacity:user:1')::uuid, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' milliseconds')::interval
      from generate_series(1, $1::int) g`, [c.items, c.rooms]);
  await client.query(`
    insert into yu_inventory.responsibility_periods
      (id, item_id, responsible_user_id, source, started_at, started_by)
    select md5('capacity:period:' || g)::uuid, md5('capacity:item:' || g)::uuid,
           md5('capacity:user:' || (((g - 1) % $2::int) + 1))::uuid,
           'migration', current_setting('yu_capacity.epoch')::timestamptz - interval '90 days' + (g || ' seconds')::interval,
           md5('capacity:user:1')::uuid
      from generate_series(1, $1::int) g`, [c.items, c.users]);
  await client.query(`
    insert into yu_inventory.photos
      (id, purpose, status, uploaded_by, original_object_key, preview_object_key,
       trusted_mime_type, byte_size, width, height, checksum_sha256,
       reserved_at, expires_at, attached_at, item_id)
    select md5('capacity:photo:' || g)::uuid, 'item', 'attached', md5('capacity:user:1')::uuid,
           'synthetic/capacity/' || g || '.jpg', 'synthetic/capacity/' || g || '-preview.jpg',
           'image/jpeg', 1024, 64, 64, repeat('a', 64), current_setting('yu_capacity.epoch')::timestamptz - interval '2 days',
           current_setting('yu_capacity.epoch')::timestamptz + interval '1 day', current_setting('yu_capacity.epoch')::timestamptz - interval '1 day', md5('capacity:item:' || g)::uuid
      from generate_series(1, $1::int) g`, [c.photos]);
  await client.query("commit");
  await insertBatches(client, c.legacyTransfers, async (first, last) => client.query(`
    insert into yu_inventory.transfers
      (id, item_id, requested_by, proposed_responsible_id, current_responsible_id_at_request,
       status, requested_at, closed_at, closed_by)
    select md5('capacity:legacy-transfer:' || g)::uuid,
           md5('capacity:item:' || (((g - 1) % $3::int) + 1))::uuid,
           md5('capacity:user:' || (((g) % ($4::int - 1)) + 2))::uuid,
           md5('capacity:user:' || (((g) % ($4::int - 1)) + 2))::uuid,
           md5('capacity:user:' || (((g - 1) % $4::int) + 1))::uuid,
           'confirmed', current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval + interval '1 minute',
           md5('capacity:user:' || (((g - 1) % $4::int) + 1))::uuid
      from generate_series($1::int, $2::int) g`, [first, last, c.items, c.users]));
  await client.query("begin");
  await client.query(`
    insert into yu_inventory.tmc_transfer_requests
      (id, initiator_id, recipient_id, status, created_at, expires_at, closed_at, closed_by)
    select md5('capacity:tmc-request:' || g)::uuid,
           md5('capacity:user:' || (((g - 1) % ($2::int - 1)) + 1))::uuid,
           md5('capacity:user:' || (((g) % ($2::int - 1)) + 2))::uuid,
           'accepted', current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval + interval '1 day',
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval + interval '1 minute',
           md5('capacity:user:' || (((g) % ($2::int - 1)) + 2))::uuid
      from generate_series(1, $1::int) g`, [c.tmcTransferRequests, c.users]);
  await client.query("commit");
  await insertBatches(client, c.tmcTransferRequestItems, async (first, last) => client.query(`
    insert into yu_inventory.tmc_transfer_request_items
      (id, request_id, item_id, result, created_at, decided_at, decided_by)
    select md5('capacity:tmc-item:' || g)::uuid,
           md5('capacity:tmc-request:' || (((g - 1) % $3::int) + 1))::uuid,
           md5('capacity:item:' || (((g - 1) % $4::int) + 1))::uuid,
           'accepted', current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval + interval '1 minute', md5('capacity:user:1')::uuid
      from generate_series($1::int, $2::int) g`, [first, last, c.tmcTransferRequests, c.items]));
  await client.query("begin");
  await client.query(`
    insert into yu_inventory.asset_loss_cases
      (id, employee_id, item_id, responsibility_period_id, status, amount, currency, created_at)
    select md5('capacity:loss:' || g)::uuid,
           md5('capacity:user:' || (((g - 1) % $2::int) + 1))::uuid,
           md5('capacity:item:' || g)::uuid, md5('capacity:period:' || g)::uuid,
           'payment_pending', 1000 + g, 'KZT', current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.assetLossCases, c.users]);
  await client.query(`
    insert into yu_inventory.asset_loss_case_events
      (id, loss_case_id, from_status, to_status, actor_id, comment, occurred_at)
    select md5('capacity:loss-event:' || g)::uuid, md5('capacity:loss:' || g)::uuid,
           null, 'payment_pending', md5('capacity:user:' || (((g - 1) % $2::int) + 1))::uuid,
           'Synthetic baseline event', current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.assetLossCases, c.users]);
  await client.query(`
    insert into yu_inventory.notification_events
      (id, domain_event_id, type, actor_id, subject_kind, subject_id, subject_revision,
       audience_kind, safe_payload, occurred_at, created_at, admin_queue_sequence)
    select md5('capacity:notification:' || g)::uuid, md5('capacity:domain-event:' || g)::uuid,
           'tmc_transfer.completed', md5('capacity:user:1')::uuid, 'tmc_transfer_request',
           md5('capacity:tmc-request:' || (((g - 1) % $2::int) + 1))::uuid, 1,
           case when g % 2 = 0 then 'admin_queue'::yu_inventory.notification_audience_kind else 'direct_user'::yu_inventory.notification_audience_kind end,
           jsonb_build_object('synthetic', true),
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           case when g % 2 = 0 then g / 2 else null end
      from generate_series(1, $1::int) g`, [c.notificationEvents, c.tmcTransferRequests]);
  await client.query(`
    insert into yu_inventory.tmc_operation_notifications (notification_event_id, request_id, item_id, created_at)
    select md5('capacity:notification:' || g)::uuid,
           md5('capacity:tmc-request:' || (((g - 1) % $2::int) + 1))::uuid,
           md5('capacity:item:' || (((g - 1) % $3::int) + 1))::uuid,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.notificationEvents, c.tmcTransferRequests, c.items]);
  await client.query(`
    insert into yu_inventory.notification_deliveries (event_id, recipient_id, mailbox_sequence, created_at)
    select md5('capacity:notification:' || g)::uuid,
           md5('capacity:user:' || (((g) % ($2::int - 1)) + 2))::uuid,
           ((g - 1) / ($2::int - 1)) + 1, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g where g % 2 = 1`, [c.notificationEvents, c.users]);
  await client.query(`
    insert into yu_inventory.tmc_web_push_outbox (notification_event_id, available_at, created_at)
    select md5('capacity:notification:' || g)::uuid, current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval,
           current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval from generate_series(1, $1::int) g`, [c.webPushOutbox]);
  await client.query(`
    insert into yu_inventory.audit_records
      (id, domain_event_id, actor_id, actor_role_snapshot, subject_kind, subject_id,
       subject_revision, action, after_values, metadata, occurred_at)
    select md5('capacity:audit:' || g)::uuid, md5('capacity:audit-domain:' || g)::uuid,
           md5('capacity:user:1')::uuid, 'admin', 'item',
           md5('capacity:item:' || (((g - 1) % $2::int) + 1))::uuid, 1,
           case when g <= 10000 then 'item.location_changed' else 'item.capacity_baseline' end,
           jsonb_build_object('synthetic', true, 'roomId', md5('capacity:room:' || (((g - 1) % 250) + 1))::uuid),
           jsonb_build_object('dataset', $3::text), current_setting('yu_capacity.epoch')::timestamptz - (g || ' seconds')::interval
      from generate_series(1, $1::int) g`, [c.auditEvents, c.items, dataset.version]);
  await client.query("commit");
  await client.query("analyze yu_inventory.users, yu_inventory.buildings, yu_inventory.rooms, yu_inventory.items, yu_inventory.responsibility_periods, yu_inventory.photos, yu_inventory.transfers, yu_inventory.tmc_transfer_requests, yu_inventory.tmc_transfer_request_items, yu_inventory.asset_loss_cases, yu_inventory.notification_events, yu_inventory.tmc_operation_notifications, yu_inventory.notification_deliveries, yu_inventory.tmc_web_push_outbox, yu_inventory.audit_records");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

console.log(`Seeded ${dataset.version} synthetic dataset.`);

async function insertBatches(database, total, insert, batchSize = 1000) {
  for (let first = 1; first <= total; first += batchSize) {
    await database.query("begin");
    try {
      await insert(first, Math.min(total, first + batchSize - 1));
      await database.query("commit");
    } catch (error) {
      await database.query("rollback").catch(() => undefined);
      throw error;
    }
  }
}
