import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOneCPublicationPlan,
  sha256CanonicalJson,
  type OneCPublicationPlanRow,
} from "../lib/one-c-reconciliation";

const rows: OneCPublicationPlanRow[] = [
  { externalId: "B", action: "link", itemId: "item-b", itemVersion: 3, inventoryNumber: "B-2" },
  { externalId: "A", action: "create", decisionVersion: 2, inventoryNumber: "A-1", barcode: "*A-1*" },
  { externalId: "C", action: "update", itemId: "item-c", itemVersion: 7 },
  { externalId: "D", action: "exclude" },
  { externalId: "E", action: "blocked" },
  { externalId: "F", action: "conflict" },
];

test("dry-run plan is deterministic, sorted, accurately counted and SHA-256 hashed", () => {
  const first = buildOneCPublicationPlan({
    batchId: "batch-1", sourceHash: "source", existingItemsVersion: "catalog-9", rows,
  });
  const second = buildOneCPublicationPlan({
    batchId: "batch-1", sourceHash: "source", existingItemsVersion: "catalog-9", rows: [...rows].reverse(),
  });
  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.rows.map((row) => row.externalId), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(
    { create: first.create, link: first.link, update: first.update, exclude: first.exclude, blocked: first.blocked, conflicts: first.conflicts },
    { create: 1, link: 1, update: 1, exclude: 1, blocked: 1, conflicts: 1 },
  );
});

test("hash changes when source, decisions or optimistic versions change", () => {
  const make = (overrides: Partial<Parameters<typeof buildOneCPublicationPlan>[0]> = {}) => buildOneCPublicationPlan({
    batchId: "batch-1", sourceHash: "source", existingItemsVersion: "catalog-9", rows, ...overrides,
  }).hash;
  assert.notEqual(make(), make({ sourceHash: "changed" }));
  assert.notEqual(make(), make({ rows: rows.map((row) => row.externalId === "A" ? { ...row, decisionVersion: 3 } : row) }));
  assert.notEqual(make(), make({ rows: rows.map((row) => row.externalId === "B" ? { ...row, itemVersion: 4 } : row) }));
});

test("canonical JSON ignores object key insertion order", () => {
  assert.equal(sha256CanonicalJson({ b: 2, a: { d: 4, c: 3 } }), sha256CanonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("dry-run detects duplicate official numbers and Code 39 barcode aliases", () => {
  const plan = buildOneCPublicationPlan({
    batchId: "batch", sourceHash: "source", existingItemsVersion: "v1",
    rows: [
      { externalId: "1", action: "create", inventoryNumber: " INV/1 ", barcode: "INV/1" },
      { externalId: "2", action: "create", inventoryNumber: "inv/1", barcode: "*YUB-INV/1*" },
      { externalId: "3", action: "exclude", inventoryNumber: "INV/1" },
    ],
  });
  assert.equal(plan.create, 0);
  assert.equal(plan.conflicts, 2);
  assert.equal(plan.exclude, 1);
  assert.deepEqual(plan.rows.map((row) => row.action), ["conflict", "conflict", "exclude"]);
});

test("duplicate external ids are rejected before publication", () => {
  assert.throws(() => buildOneCPublicationPlan({
    batchId: "batch", sourceHash: "source", existingItemsVersion: "v1",
    rows: [{ externalId: "GUID", action: "create" }, { externalId: "guid", action: "exclude" }],
  }), /duplicate_external_id/);
});
