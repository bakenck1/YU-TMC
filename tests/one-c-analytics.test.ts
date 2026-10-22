import assert from "node:assert/strict";
import test from "node:test";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import { canAccessPath } from "../lib/security/authorization";

const row = (override: Partial<AuditMatch> = {}): AuditMatch => ({ itemId: "a", itemName: "Стол", siteNumber: "1", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null, oneC: [], excel: [], ...override });
const asset: AuditMatch["oneC"][number] = { externalId: "asset", code: "1", inventoryNumber: "1", barcode: null, name: "Стол", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["inventory_number"], matchedBarcodes: [] };
const material: AuditMatch["excel"][number] = { sourceKey: "balance", sourceKind: "materials_api", oneCCode: "m1", rowNumber: 1, inventoryNumber: "1", explicitInventoryNumber: "1", nomenclature: "Стол", endingBalance: "3", matchedBy: ["site_number"] };

test("categories partition cards while temporary numbers remain independent", () => {
  const summary = summarizeOneCAudit([
    row({ oneC: [asset] }),
    row({ itemId: "mp", siteNumber: "2", excel: [{ ...material, explicitInventoryNumber: "2", inventoryNumber: "2" }, { ...material, sourceKey: "balance2", rowNumber: 2, explicitInventoryNumber: "2", inventoryNumber: "2" }] }),
    row({ itemId: "both", siteNumber: "TMP-1", siteBarcodes: [{ value: "3", kind: "official" }], oneC: [{ ...asset, externalId: "both-os", inventoryNumber: "3" }], excel: [{ ...material, rowNumber: 3, sourceKey: "both-mp", explicitInventoryNumber: "3", inventoryNumber: "3" }], numberKind: "temporary" }),
    row({ itemId: "weak", oneC: [{ ...asset, externalId: "weak", inventoryNumber: "1-2", matchedBy: ["number_suffix"] }] }), row({ itemId: "missing", result: "temporary", numberKind: "temporary" }),
  ], ["asset", "both-os", "weak", "unmatched", "unmatched"], ["balance", "balance2", "both-mp", "other"]);
  assert.deepEqual(summary, { total: 5, fixedAssets: 1, materials: 1, both: 1, possible: 1, missing: 1, temporary: 2, assetsWithoutCandidate: 1, materialBalancesWithoutCandidate: 1 });
});

test("code-only candidates, contradicting full fields and multiple OS identities remain unconfirmed", () => {
  const summary = summarizeOneCAudit([
    row({ itemId: "code", oneC: [{ ...asset, externalId: "code-only", inventoryNumber: null, matchedBy: ["code"] }] }),
    row({ itemId: "barcode-conflict", oneC: [{ ...asset, externalId: "contradiction", barcode: "999", matchedBy: ["inventory_number"] }] }),
    row({ itemId: "multiple", oneC: [{ ...asset, externalId: "a" }, { ...asset, externalId: "b" }] }),
    row({ itemId: "mp-code", excel: [{ ...material, inventoryNumber: "", explicitInventoryNumber: null, matchedBy: ["code"] }] }),
  ], [], []);
  assert.equal(summary.possible, 4);
  assert.equal(summary.fixedAssets + summary.materials + summary.both, 0);
});

test("source reuse across cards cannot inflate confirmed counts in either registry", () => {
  const presence = classifyOneCAudit([
    row({ itemId: "first", oneC: [asset], excel: [material] }),
    row({ itemId: "second", oneC: [asset], excel: [material] }),
  ]);
  assert.equal(presence.get("first")!.category, "possible");
  assert.equal(presence.get("second")!.category, "possible");
});

test("exact complete identifiers in names confirm presence, independently of name update constraints", () => {
  const presence = classifyOneCAudit([
    row({ itemId: "description", siteNumber: "2411/00390", oneC: [{ ...asset, externalId: "description", inventoryNumber: null, name: "Ноутбук Lenovo IdeaPad №2411/00390", matchedBy: ["number_in_description"] }] }),
    row({ itemId: "invalid-name", oneC: [{ ...asset, externalId: "long-name", name: "x".repeat(161) }] }),
  ]);
  assert.equal(presence.get("description")!.category, "fixedAssets");
  assert.equal(presence.get("invalid-name")!.category, "fixedAssets");
});

test("each registry is confirmed independently, so one valid source still establishes presence", () => {
  const presence = classifyOneCAudit([
    row({ itemId: "os-only", oneC: [asset], excel: [{ ...material, explicitInventoryNumber: "999" }] }),
    row({ itemId: "mp-only", oneC: [{ ...asset, externalId: "bad-os", inventoryNumber: "999" }], excel: [{ ...material, rowNumber: 2, sourceKey: "second" }] }),
  ]);
  assert.deepEqual(presence.get("os-only"), { fixedAssets: true, materials: false, category: "fixedAssets" });
  assert.deepEqual(presence.get("mp-only"), { fixedAssets: false, materials: true, category: "materials" });
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
