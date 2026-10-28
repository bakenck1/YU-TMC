import assert from "node:assert/strict";
import test from "node:test";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import { canAccessPath } from "../lib/security/authorization";
import { buildOneCReconciliationReport } from "../lib/one-c-reconciliation-report";
import type { getOneCAnalyticsSnapshot } from "../lib/server/one-c-analytics-service";

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
  assert.deepEqual(summary, { total: 5, fixedAssets: 1, materials: 2, both: 0, possible: 1, missing: 0, temporary: 2, temporaryUnmatched: 1, temporaryFound: 1, temporaryPossible: 0, assetsWithoutCandidate: 1, materialBalancesWithoutCandidate: 1 });
});

test("code alone does not prove presence, while a full identifier does not require choosing an update record", () => {
  const summary = summarizeOneCAudit([
    row({ itemId: "code", oneC: [{ ...asset, externalId: "code-only", inventoryNumber: null, matchedBy: ["code"] }] }),
    row({ itemId: "barcode-conflict", oneC: [{ ...asset, externalId: "contradiction", barcode: "999", matchedBy: ["inventory_number"] }] }),
    row({ itemId: "multiple", oneC: [{ ...asset, externalId: "a" }, { ...asset, externalId: "b" }] }),
    row({ itemId: "mp-code", excel: [{ ...material, inventoryNumber: "", explicitInventoryNumber: null, matchedBy: ["code"] }] }),
  ], [], []);
  assert.equal(summary.possible, 2);
  assert.equal(summary.fixedAssets, 2);
});

test("each card with the same complete number has a source record, without double-counting a card", () => {
  const presence = classifyOneCAudit([
    row({ itemId: "first", oneC: [asset], excel: [material] }),
    row({ itemId: "second", oneC: [asset], excel: [material] }),
  ]);
  assert.equal(presence.get("first")!.category, "both");
  assert.equal(presence.get("second")!.category, "both");
  assert.equal(presence.size, 2);
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

test("several materials with the same complete number establish presence but do not choose a price or owner", () => {
  const summary = summarizeOneCAudit([row({ excel: [material, { ...material, oneCCode: "m2", sourceKey: "another" }] })], [], ["balance", "another"]);
  assert.equal(summary.possible, 0);
  assert.equal(summary.materials, 1);
  assert.equal(summary.materialBalancesWithoutCandidate, 0);
});

test("empty input is finite and the new page retains the existing integration permissions", () => {
  assert.equal(summarizeOneCAudit([], [], []).total, 0);
  assert.equal(canAccessPath("admin", "/integrations/1c"), true);
  for (const role of ["employee", "warehouse", "typography", "passport_author", "passport_reviewer"]) {
    assert.equal(canAccessPath(role, "/integrations/1c"), canAccessPath(role, "/settings/integrations/1c"));
  }
});

test("temporary total partitions into found, possible and unmatched without double counting both registries", () => {
  const counts = summarizeOneCAudit([
    row({itemId:'both', numberKind:'temporary', siteOneCCode:'1', oneC:[asset], excel:[{...material, oneCCode:'1'}]}),
    row({itemId:'possible', numberKind:'temporary', siteNumber:'TMP-2', oneC:[{...asset, inventoryNumber:'99'}]}),
    row({itemId:'missing', numberKind:'temporary', siteNumber:'TMP-3'}),
  ], [], []);
  assert.equal(counts.temporary, 3);
  assert.equal(counts.temporaryFound, 1);
  assert.equal(counts.temporaryPossible, 1);
  assert.equal(counts.temporaryUnmatched, 1);
  assert.equal(counts.temporary, counts.temporaryFound + counts.temporaryPossible + counts.temporaryUnmatched);
});

test("screenshot counts distinguish all 946 temporary cards from 742 unmatched cards", () => {
  const rows = [
    ...Array.from({length:1116}, (_,i) => row({itemId:`os-${i}`, oneC:[asset], numberKind:i < 204 ? 'temporary' : 'official'})),
    ...Array.from({length:573}, (_,i) => row({itemId:`mp-${i}`, excel:[material]})),
    ...Array.from({length:742}, (_,i) => row({itemId:`temp-${i}`, numberKind:'temporary'})),
    ...Array.from({length:135}, (_,i) => row({itemId:`missing-${i}`})),
  ];
  const c = summarizeOneCAudit(rows, [], []);
  assert.equal(c.total, 2566);
  assert.equal(c.temporary, 946);
  assert.equal(c.temporaryFound, 204);
  assert.equal(c.temporaryUnmatched, 742);
  assert.equal(c.fixedAssets + c.materials + c.both, 1689);
  assert.equal(c.missing, 135);
  assert.equal(c.fixedAssets+c.materials+c.both+c.possible+c.missing+c.temporaryUnmatched,c.total);
});

test("521 MP cards already include 30 temporary matches; confirming 30 additional unmatched cards moves counts to 551 and 891", () => {
  const rows = [
    ...Array.from({ length: 889 }, (_, i) => row({ itemId: `os-${i}`, oneC: [asset] })),
    ...Array.from({ length: 491 }, (_, i) => row({ itemId: `mp-${i}`, excel: [material] })),
    ...Array.from({ length: 30 }, (_, i) => row({ itemId: `found-temp-${i}`, siteNumber: `TMP-FOUND-${i}`, numberKind: "temporary", siteOneCCode: "m1", excel: [material] })),
    ...Array.from({ length: 921 }, (_, i) => row({ itemId: `missing-temp-${i}`, siteNumber: `TMP-MISSING-${i}`, numberKind: "temporary" })),
    ...Array.from({ length: 220 }, (_, i) => row({ itemId: `missing-${i}` })),
  ];
  const snapshot = (auditRows: AuditMatch[]): Awaited<ReturnType<typeof getOneCAnalyticsSnapshot>> => ({
    rows: auditRows, assets: [], registryAssets: [], materialRecords: [],
    inventory: auditRows.map(row => ({ id: row.itemId, oneCCode: row.siteOneCCode ?? null, status: "active", quantity: 1 })),
    analytics: {
      calculatedAt: "2026-10-28T00:00:00Z",
      assets: { total: 0, active: 0, retired: 0, other: 0, receivedAt: null },
      inventory: { total: auditRows.length, active: auditRows.length, quantity: auditRows.length },
      reconciliation: summarizeOneCAudit(auditRows, [], []),
    },
    materials: { kind: "materials_api", batchId: null, receivedAt: null, snapshotAt: null, sha256: "test", rowCount: 0, materialCount: 0, positiveRows: 0, nonPositiveRows: 0 },
  });
  const before = buildOneCReconciliationReport(snapshot(rows));
  assert.equal(before.verified, true);
  assert.equal(before.counters.total, 2551);
  assert.equal(before.counters.materials, 521);
  assert.equal(before.counters.temporaryFound, 30);
  assert.equal(before.counters.temporaryUnmatched, 921);
  assert.equal(before.temporaryFoundCards.length, 30);
  assert.ok(before.temporaryFoundCards.every(card => card.group === "materials"));

  const newlyFound = new Set(Array.from({ length: 30 }, (_, i) => `missing-temp-${i}`));
  const after = buildOneCReconciliationReport(snapshot(rows.map(row => newlyFound.has(row.itemId)
    ? { ...row, siteOneCCode: "m1", excel: [material] } : row)));
  assert.equal(after.verified, true);
  assert.equal(after.counters.materials, 551);
  assert.equal(after.counters.temporaryUnmatched, 891);
  assert.equal(after.counters.temporaryFound, 60);
  assert.equal(after.counters.total, 2551);
});
