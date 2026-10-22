import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import { canAccessPath } from "../lib/security/authorization";

const row = (override: Partial<AuditMatch> = {}): AuditMatch => ({ itemId: "a", itemName: "Стол", siteNumber: "1", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null, oneC: [], excel: [], ...override });
const asset: AuditMatch["oneC"][number] = { externalId: "asset", code: "1", inventoryNumber: "1", barcode: null, name: "Стол", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["inventory_number"], matchedBarcodes: [] };
const material: AuditMatch["excel"][number] = { sourceKey: "balance", sourceKind: "materials_api", oneCCode: "m1", rowNumber: 1, inventoryNumber: "1", nomenclature: "Стол", endingBalance: "3", matchedBy: ["code"] };

test("categories partition cards while temporary numbers remain independent", () => {
  const summary = summarizeOneCAudit([
    row({ oneC: [asset] }), row({ excel: [material, { ...material, sourceKey: "balance2" }] }),
    row({ oneC: [asset], excel: [material], numberKind: "temporary" }),
    row({ oneC: [{ ...asset, externalId: "weak", matchedBy: ["number_without_slash"] }] }), row({ result: "temporary", numberKind: "temporary" }),
  ], ["asset", "weak", "unmatched", "unmatched"], ["balance", "balance2", "other"]);
  assert.deepEqual(summary, { total: 5, fixedAssets: 1, materials: 1, both: 1, possible: 1, missing: 1, temporary: 2, assetsWithoutCandidate: 1, materialBalancesWithoutCandidate: 1 });
});

test("different material identities are review candidates rather than confirmed materials", () => {
  const summary = summarizeOneCAudit([row({ excel: [material, { ...material, oneCCode: "m2", sourceKey: "another" }] })], [], ["balance", "another"]);
  assert.equal(summary.possible, 1);
  assert.equal(summary.materials, 0);
  assert.equal(summary.materialBalancesWithoutCandidate, 0);
});

test("empty input is finite and the new page retains the existing integration permissions", () => {
  assert.equal(summarizeOneCAudit([], [], []).total, 0);
  assert.equal(canAccessPath("admin", "/integrations/1c"), true);
  for (const role of ["employee", "warehouse", "typography", "passport_author", "passport_reviewer"]) {
    assert.equal(canAccessPath(role, "/integrations/1c"), canAccessPath(role, "/settings/integrations/1c"));
  }
});
