import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "../lib/inventory-audit-enrichment";
import type { AuditMatch } from "../lib/inventory-source-audit";

test("a safe 1C name cannot confirm a code across contradictory complete source identities", () => {
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
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.equal(plan.rows[0].eligible, true, "The independently verified 1C name remains usable");
  assert.equal(plan.rows[0].nextName, row.oneC[0].name);
  assert.equal(plan.rows[0].nextCode, null, "Different complete slash boundaries cannot confirm a code");
  assert.equal(plan.rows[0].codeStatus, "identity_conflict");
});
