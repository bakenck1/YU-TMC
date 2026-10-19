import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import { readMaterialRegistry, getMaterialRegistryPage } from "@/lib/server/one-c-material-registry";
import { buildInventorySourceAudit, type AuditItem } from "@/lib/inventory-source-audit";
import { auditNeedsReview } from "@/lib/inventory-source-audit-review";
import { buildInventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";

const material: OneCMaterial = { externalId: null, code: "0000007692", name: "Рукав №1350/14444",
  warehouseExternalId: null, warehouseCode: null, warehouseName: null, responsibleCode: "001", responsibleName: "Иванов",
  accountCode: "1317", balanceSchemaVersion: 2, inventoryNumber: null, barcode: null,
  unit: "компл", quantity: "7", unitPrice: "9100", currency: "KZT" };
const item: AuditItem = { id: "item-1", name: "Наше название", inventoryNumber: "1350/14444", inventoryNumberKind: "official", oneCCode: null, officialBarcodes: [], sourceCodes: [], version: 1 };
function database(materials: OneCMaterial[]) {
  return { query: async (sql: string) => {
    assert.ok(sql.includes("superseded_at is null"));
    assert.ok(!sql.includes("material_snapshots"));
    return { rows: materials.map((payload, index) => ({ payload, row_key: `key-${index}`, payload_hash: `${index}`.padStart(64, "0"), batch_id: "batch", received_at: "2026-10-16T14:03:21Z", source_snapshot_at: "2026-10-16T14:03:08Z" })) };
  } } as unknown as Pick<Pool, "query">;
}

test("reads source API balances without any Excel selection, retaining separate MOL evidence", async () => {
  const source = await readMaterialRegistry(database([material, { ...material, responsibleCode: "002", quantity: "15" }, { ...material, responsibleCode: "003", quantity: "1" }]));
  assert.equal(source.metadata.rowCount, 3);
  assert.equal(source.metadata.materialCount, 1);
  assert.equal(source.metadata.positiveRows, 3);
  const audit = buildInventorySourceAudit([item], [], source.rows, []);
  assert.equal(audit.counts.excelOnly, 1);
  assert.equal(audit.rows[0].excel.length, 3);
  assert.deepEqual(audit.rows[0].excel.map(row => row.endingBalance), ["7", "15", "1"]);
  assert.ok(auditNeedsReview(audit.rows[0]), "numbers extracted from names remain review-only");
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...item, itemSection: "general" }]).counts.ready, 0);
});

test("zero and negative balances never confirm a match; exact codes work without inventory numbers", async () => {
  const source = await readMaterialRegistry(database([
    { ...material, name: "Без номера", quantity: "0" }, { ...material, name: "Без номера", quantity: "-1" },
    { ...material, name: "Без номера", code: "00042", quantity: "1" },
  ]));
  assert.equal(source.metadata.nonPositiveRows, 2);
  const audit = buildInventorySourceAudit([{ ...item, oneCCode: "00042" }, { ...item, id: "unmatched", oneCCode: material.code }], [], source.rows, []);
  assert.equal(audit.rows.find(row => row.itemId === "item-1")?.source, "excel");
  assert.equal(audit.rows.find(row => row.itemId === "unmatched")?.source, null);
  assert.deepEqual(audit.rows.find(row => row.itemId === "item-1")?.excel[0].matchedBy, ["code"]);
  assert.equal(auditNeedsReview(audit.rows.find(row => row.itemId === "item-1")!), false);
  assert.equal(buildInventorySourceAudit([{ ...item, oneCCode: "42" }], [], source.rows, []).rows[0].source, null);
});

test("description alone cannot create a match; explicit barcode and inventory number retain precise evidence", async () => {
  const source = await readMaterialRegistry(database([{ ...material, name: "Без номера", inventoryNumber: "1350/14444" }]));
  const audit = buildInventorySourceAudit([item], [], source.rows, []);
  assert.equal(auditNeedsReview(audit.rows[0]), false);
  const other = await readMaterialRegistry(database([{ ...material, name: item.name.replace("Наше название", "Наше название без номера") }]));
  assert.equal(buildInventorySourceAudit([{ ...item, inventoryNumber: "999/99" }], [], other.rows, []).rows[0].source, null);
});

test("different materials matching one card are flagged instead of silently choosing a name", async () => {
  const source = await readMaterialRegistry(database([
    { ...material, inventoryNumber: item.inventoryNumber },
    { ...material, code: "000099", inventoryNumber: item.inventoryNumber },
  ]));
  assert.equal(auditNeedsReview(buildInventorySourceAudit([item], [], source.rows, []).rows[0]), true);
});

test("identical material balances across MOLs permit only reviewed identity-backed name enrichment", async () => {
  const source = await readMaterialRegistry(database([
    { ...material, inventoryNumber: item.inventoryNumber },
    { ...material, inventoryNumber: item.inventoryNumber, responsibleCode: "002", quantity: "15" },
  ]));
  const audit = buildInventorySourceAudit([item], [], source.rows, []);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...item, itemSection: "general", quantity: 1 }]);
  assert.equal(plan.counts.ready, 1);
  assert.equal(plan.rows[0].nameSource, "materials_api");
  assert.equal(plan.rows[0].nextCode, material.code);
  const codeOnly = buildInventorySourceAudit([{ ...item, inventoryNumber: "999/99", oneCCode: material.code }], [], source.rows, []);
  assert.equal(buildInventoryAuditEnrichmentPlan(codeOnly.rows, [{ ...item, inventoryNumber: "999/99", oneCCode: material.code, itemSection: "general" }]).counts.ready, 0);
});

test("registry fingerprint changes when source payload changes and works with no imported materials", async () => {
  const a = await readMaterialRegistry(database([material]));
  const b = await readMaterialRegistry({ query: async () => ({ rows: [{ row_key: "key-0", payload_hash: "changed", payload: material }] }) } as unknown as Pick<Pool, "query">);
  assert.notEqual(a.metadata.sha256, b.metadata.sha256);
  const empty = await readMaterialRegistry(database([]));
  assert.equal(empty.metadata.batchId, null);
  assert.equal(empty.metadata.rowCount, 0);
  assert.deepEqual(empty.rows, []);
});

test("number and barcode matching survive saving the reviewed 1C code and keep the same card", async () => {
  const source = await readMaterialRegistry(database([{ ...material, inventoryNumber: item.inventoryNumber, barcode: item.inventoryNumber }]));
  const original = { ...item, officialBarcodes: [item.inventoryNumber] };
  const before = buildInventorySourceAudit([original], [], source.rows, []);
  assert.ok(before.rows[0].excel[0].matchedBy?.includes("site_number"));
  assert.ok(before.rows[0].excel[0].matchedBy?.includes("barcode"));
  const proposal = buildInventoryAuditEnrichmentPlan(before.rows, [{ ...original, itemSection: "general" }]);
  assert.equal(proposal.counts.ready, 1);
  assert.equal(proposal.rows[0].nextCode, "0000007692");
  const saved = { ...original, oneCCode: proposal.rows[0].nextCode, name: proposal.rows[0].nextName, version: 2 };
  const after = buildInventorySourceAudit([saved], [], source.rows, []);
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].itemId, original.id);
  assert.equal(after.rows[0].excel.length, 1);
  assert.deepEqual(new Set(after.rows[0].excel[0].matchedBy), new Set(["site_number", "barcode", "number_in_description", "code"]));
  assert.equal(buildInventoryAuditEnrichmentPlan(after.rows, [{ ...saved, itemSection: "general" }]).counts.unchanged, 1);
  const differentCode = buildInventorySourceAudit([{ ...original, oneCCode: "DIFFERENT" }], [], source.rows, []);
  assert.equal(differentCode.rows[0].source, "excel", "code mismatch must not disable number/barcode evidence");
  assert.equal(original.oneCCode, null, "matching and preview must not mutate the original card");
});

test("registry search uses bound parameters, escapes wildcards and returns totals even beyond last page", async () => {
  let parameters: unknown[] = [];
  const db = { query: async (sql: string, values: unknown[]) => {
    assert.ok(sql.includes("superseded_at is null"));
    assert.ok(!sql.includes("attack%"));
    parameters = values;
    return { rows: [{ data: [], total: 123 }] };
  } } as unknown as Pick<Pool, "query">;
  const page = await getMaterialRegistryPage({ page: 4, pageSize: 50, search: "attack%_" }, db);
  assert.deepEqual(parameters, ["%attack\\%\\_%", 50, 150]);
  assert.equal(page.total, 123);
});
