import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "../lib/inventory-audit-enrichment";
import type { AuditMatch } from "../lib/inventory-source-audit";

function fixture(): { item: InventoryAuditEnrichmentItem; row: AuditMatch } {
  const item: InventoryAuditEnrichmentItem = {
    id: "site-1", name: "Ноутбук", inventoryNumber: "241100388", officialBarcodes: ["2411/00388"],
    oneCCode: null, version: 7, itemSection: "general", archivedAt: null,
  };
  const row: AuditMatch = {
    itemId: item.id, itemName: item.name, siteNumber: item.inventoryNumber,
    siteBarcodes: [{ kind: "official", value: "2411/00388" }], numberKind: "official",
    itemVersion: item.version, result: "matched", source: "1c+excel",
    oneC: [{
      externalId: "asset-1", code: "00003254", inventoryNumber: "241100388", barcode: "2411/00388",
      name: "Ноутбук Lenovo №2411/00388", status: "Принято к учёту", origins: ["current_registry"],
      matchedBy: ["inventory_number", "barcode"], matchedBarcodes: ["2411/00388"],
    }],
    excel: [{
      rowNumber: 14, inventoryNumber: "24110/0388", nomenclature: "Ноутбук Lenovo №24110/0388",
      oneCCode: "00003254", endingBalance: "1", matchedBy: ["number_without_slash"],
    }],
  };
  return { item, row };
}

test("safe 1C supplies its name and code despite a contradictory Excel slash boundary", () => {
  const { item, row } = fixture();
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.equal(plan.rows[0].eligible, true, "The independently verified 1C source remains usable");
  assert.equal(plan.rows[0].nextName, row.oneC[0].name);
  assert.equal(plan.rows[0].nextCode, "00003254");
  assert.equal(plan.rows[0].codeStatus, "confirmed");
});

test("contradictory complete boundaries inside 1C block both fields and Excel fallback", () => {
  for (const field of ["inventoryNumber", "barcode", "name"] as const) {
    const { item, row } = fixture();
    row.excel[0].inventoryNumber = "2411/00388";
    row.excel[0].nomenclature = "Ноутбук Lenovo №2411/00388";
    if (field === "name") row.oneC[0].name = "Ноутбук Lenovo №24110/0388";
    else row.oneC[0][field] = "24110/0388";
    const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
    assert.equal(plan.rows[0].reason, "identity_conflict", field);
    assert.equal(plan.rows[0].nextName, item.name);
    assert.equal(plan.rows[0].nextCode, item.oneCCode);
  }
});
