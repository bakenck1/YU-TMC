// Fixed read-only production audit. Run as the service account on the server.
// No arguments, arbitrary SQL, writes, credentials, or user contact data.
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
  const items = (await client.query(`select id,name,description,inventory_number,inventory_number_kind,
    inventory_number_key,one_c_code,brand,model,item_type,item_section,version,created_at,updated_at,archived_at
    from yu_inventory.items order by id`)).rows;
  const history = (await client.query(`select item_id,kind,value,comparison_key,assigned_at,replaced_at,reason
    from yu_inventory.item_inventory_number_history order by item_id,assigned_at,id`)).rows;
  const audit = (await client.query(`select id,subject_id,subject_revision,action,occurred_at,
    before_values,after_values from yu_inventory.audit_records
    where subject_kind='item' and (before_values ? 'inventoryNumber' or after_values ? 'inventoryNumber'
      or before_values ? 'name' or after_values ? 'name') order by occurred_at,id`)).rows;
  const barcodes = (await client.query(`select item_id,kind,original_value from yu_inventory.barcode_registry order by item_id,kind,original_value`)).rows;
  const links = (await client.query(`select item_id,source_inventory_number,source_code,external_id,link_method
    from yu_inventory.item_one_c_links order by item_id,external_id`)).rows;
  const official = value => typeof value === "string" && value.trim() && value.trim() !== "-" && !/^(TMP-|YUI-)/iu.test(value.trim());
  const suspectIds = new Set(items.filter(item => !official(item.inventory_number)).map(item => item.id));
  const recoveredEvidence = new Set([
    ...history.filter(row => suspectIds.has(row.item_id) && official(row.value)).map(row => row.item_id),
    ...audit.filter(row => suspectIds.has(row.subject_id) && (official(row.before_values?.inventoryNumber) || official(row.after_values?.inventoryNumber))).map(row => row.subject_id),
  ]);
  const target = items.filter(item => item.inventory_number === "TMP-2026-859969B9DC72FFEA69D6");
  const targetIds = new Set(target.map(item => item.id));
  await client.query("rollback");
  console.log(JSON.stringify({ readOnly: true, capturedAt: new Date().toISOString(),
    counts: { items: items.length, temporaryOrMissing: suspectIds.size, formerlyOfficial: recoveredEvidence.size },
    target, targetHistory: history.filter(row => targetIds.has(row.item_id)),
    targetAudit: audit.filter(row => targetIds.has(row.subject_id)),
    items, history, identifierAudit: audit, barcodes, links,
  }, null, 2));
} catch (error) {
  await client?.query("rollback").catch(() => {});
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,40}$/u.test(error.code) ? error.code : "diagnostic_failed";
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool?.end();
}
