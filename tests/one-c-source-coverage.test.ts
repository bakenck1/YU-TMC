import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOneCSourceCoverage } from "../lib/one-c-source-coverage";
import type { AuditMatch } from "../lib/inventory-source-audit";

const row: AuditMatch = {
  itemId: "card", itemName: "Стол", siteNumber: "1", siteBarcodes: [], numberKind: "official", itemVersion: 1,
  result: "matched", source: null,
  oneC: [{ externalId: "os-1", code: "001", inventoryNumber: "1-2", barcode: null, name: "Стол", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["number_suffix"], matchedBarcodes: [] }],
  excel: [{ sourceKey: "m1-owner-a", sourceKind: "materials_api", oneCCode: "001", rowNumber: 1, inventoryNumber: "1-2", nomenclature: "Стол", endingBalance: "3", matchedBy: ["number_suffix"] }],
};
const record = (key: string, code: string, quantity = "1") => ({ key, material: { code, quantity } });

test("reverse reconciliation counts GUIDs and material codes once, while retaining balance row counts", () => {
  const summary = summarizeOneCSourceCoverage([row, { ...row, itemId: "second-card" }], ["os-1", "os-1", "os-2"], [
    record("m1-owner-a", "001", "10"), record("m1-owner-b", "001", "20"),
    record("m2-owner-a", "002"), record("m2-owner-b", "002", "30"),
    record("m2-owner-b", "002", "30"), record("m3", "003", "200"),
  ]);
  assert.deepEqual(summary, {
    assets: { total: 2, withCandidate: 1, withoutCandidate: 1 },
    materials: { total: 3, withCandidate: 1, withoutCandidate: 2, balanceRows: 5, balanceRowsWithoutCandidate: 4 },
  });
  // The unmatched balance for code 001 does not make the whole code absent.
  assert.equal(summary.materials.total, summary.materials.withCandidate + summary.materials.withoutCandidate);
  assert.equal(summary.assets.total, summary.assets.withCandidate + summary.assets.withoutCandidate);
});

test("nonpositive stock and candidates outside the supplied source scope never affect the totals", () => {
  assert.deepEqual(summarizeOneCSourceCoverage([row], ["other-os"], [
    record("m1-owner-a", "001", "0"), record("negative", "002", "-2"), record("positive", "003", "0.5"),
  ]), {
    assets: { total: 1, withCandidate: 0, withoutCandidate: 1 },
    materials: { total: 1, withCandidate: 0, withoutCandidate: 1, balanceRows: 1, balanceRowsWithoutCandidate: 1 },
  });
});

test("exact material codes stay distinct and large physical quantities never inflate positions", () => {
  const summary = summarizeOneCSourceCoverage([], [], [record("a", "001", "100000"), record("b", "1", "0.25")]);
  assert.equal(summary.materials.total, 2);
  assert.equal(summary.materials.withoutCandidate, 2);
  assert.equal(summarizeOneCSourceCoverage([], [], []).materials.total, 0);
});
