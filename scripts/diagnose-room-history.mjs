// Fixed read-only snapshot for the B201/D201 historical investigation.
import { createRequire } from "node:module";

const app = "/opt/yu-inventory/current";
let pool;
let client;
try {
  if (process.argv.length !== 2 || process.getuid?.() !== 999) throw new Error("invalid_invocation");
  process.chdir(app);
  process.loadEnvFile(`${app}/.env.production.local`);
  process.env.TSX_DISABLE_CACHE = "1";
  const require = createRequire(`${app}/package.json`);
  require("tsx/cjs");
  const { readDatabaseConfig } = require(`${app}/lib/db/env.ts`);
  const { createPostgresPool } = require(`${app}/lib/db/pool.ts`);
  pool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "production" }), { max: 1 });
  client = await pool.connect();
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local statement_timeout='30s'");
  if ((await client.query("show transaction_read_only")).rows[0]?.transaction_read_only !== "on") throw new Error("readonly_required");
  const tables = {};
  tables.buildings = (await client.query(`select id,name,status,version,created_at,updated_at,archived_at from yu_inventory.buildings order by id`)).rows;
  tables.rooms = (await client.query(`select id,building_id,designation,floor_number,status,version,created_at,updated_at,archived_at,created_by,updated_by,primary_responsible_id from yu_inventory.rooms order by id`)).rows;
  tables.items = (await client.query(`select id,name,description,room_id,inventory_number,inventory_number_kind,item_type,item_section,brand,model,quantity,status,version,created_at,updated_at,archived_at,created_by,updated_by from yu_inventory.items order by id`)).rows;
  tables.audit_records = (await client.query(`select id,actor_id,actor_role_snapshot,subject_kind,subject_id,subject_revision,action,before_values,after_values,metadata,occurred_at from yu_inventory.audit_records where subject_kind::text in ('building','room','item','responsibility','transfer','tmc_transfer_request','photo') order by occurred_at,id`)).rows;
  tables.item_inventory_number_history = (await client.query(`select item_id,kind,value,assigned_at,assigned_by,replaced_at,replaced_by,reason from yu_inventory.item_inventory_number_history order by item_id,assigned_at`)).rows;
  tables.responsibility_periods = (await client.query(`select item_id,responsible_user_id,started_at,started_by,ended_at,ended_by,source from yu_inventory.responsibility_periods order by item_id,started_at`)).rows;
  tables.photos = (await client.query(`select id,item_id,purpose,status,checksum_sha256,reserved_at,attached_at from yu_inventory.photos where item_id is not null order by item_id,reserved_at`)).rows;
  tables.users = (await client.query(`select id,full_name,role from yu_inventory.users order by id`)).rows;
  await client.query("rollback");
  console.log(JSON.stringify({ readOnly: true, capturedAt: new Date().toISOString(), tables }));
} catch (error) {
  await client?.query("rollback").catch(() => {});
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,40}$/u.test(error.code) ? error.code : "diagnostic_failed";
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool?.end();
}
