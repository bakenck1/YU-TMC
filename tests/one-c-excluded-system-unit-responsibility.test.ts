import assert from "node:assert/strict";
import test from "node:test";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { InventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCResponsibilityProposals } from "../lib/one-c-enrichment-responsibility";

const sourceOwner = "Тестовый Бывший Сотрудник";
function review(number: string, name: string, source: "os" | "mp" | "both", assigned = false, changed = false) {
  const plan: InventoryAuditEnrichmentPlan = {
    rows: [{ itemId: "item", itemVersion: 1, currentName: name, nextName: name,
      currentCode: "source-code", nextCode: "source-code", eligible: true, changed,
      reason: changed ? "confirmed" : "unchanged", siteNumber: number,
      ...(changed ? { price: { currentUnitPrice: "0.00", nextUnitPrice: "24850.00", changed: true, status: "ready" as const } } : {}) }],
    counts: { ready: changed ? 1 : 0, unchanged: changed ? 0 : 1, skipped: 0 },
  };
  const evidence: AuditMatch = {
    itemId: "item", itemName: name, siteNumber: number, siteOneCCode: "source-code",
    siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null,
    oneC: source === "mp" ? [] : [{ externalId: "os", code: "source-code", name, inventoryNumber: number,
      barcode: null, responsibleName: sourceOwner, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["code"], matchedBarcodes: [] }],
    excel: source === "os" ? [] : [{ rowNumber: 1, sourceKind: "materials_api", sourceKey: "mp", oneCCode: "source-code",
      nomenclature: name, inventoryNumber: number, endingBalance: "1", responsibleName: sourceOwner, matchedBy: ["code"] }],
  };
  addOneCResponsibilityProposals(plan, [evidence], new Map([["os", sourceOwner]]),
    [{ id: "former", fullName: sourceOwner, role: "employee", active: true, deleted: false }],
    [{ itemId: "item", userId: assigned ? "manual" : null, name: assigned ? "Назначен вручную" : null, pendingTransfer: false, unavailable: false }]);
  return plan;
}

for (const source of ["os", "mp", "both"] as const) {
  test(`${source}: the three selected system units never inherit a source owner`, () => {
    for (const number of ["123/357", "123/358", "123/353", " 123 / 357 ", "１２３/３５８"]) {
      const plan = review(number, `Системный блок в сборе Intel инв№${number}`, source);
      assert.equal(plan.rows[0].responsibility?.status, "not_allowed", number);
      assert.equal(plan.rows[0].responsibility?.changed, false, number);
      assert.equal(plan.rows[0].responsibility?.nextUserId, null, number);
      assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
    }
  });
  test(`${source}: monitors sharing the numbers and other system units remain eligible`, () => {
    for (const number of ["123/357", "123/358", "123/353"]) {
      assert.equal(review(number, "Монитор", source).rows[0].responsibility?.status, "ready");
    }
    for (const number of ["123/354", "123/3570", "0123/357", "123/357-01"]) {
      assert.equal(review(number, "Системный блок в сборе Intel", source).rows[0].responsibility?.status, "ready", number);
    }
  });
}

test("a manual assignment is preserved for an excluded system unit", () => {
  const proposal = review("123/357", "Системный блок", "both", true).rows[0].responsibility!;
  assert.equal(proposal.status, "unchanged");
  assert.equal(proposal.changed, false);
  assert.equal(proposal.nextUserId, "manual");
});

test("the exception does not discard a planned price update", () => {
  const plan = review("123/353", "Системный блок", "both", false, true);
  assert.equal(plan.rows[0].responsibility?.changed, false);
  assert.equal(plan.rows[0].changed, true);
  assert.equal(plan.rows[0].price?.nextUnitPrice, "24850.00");
  assert.equal(plan.rows[0].price?.changed, true);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
});
