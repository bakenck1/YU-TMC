import assert from "node:assert/strict";
import test from "node:test";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { InventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCResponsibilityProposals, type EnrichmentResponsibleUser, type EnrichmentResponsibilityState } from "../lib/one-c-enrichment-responsibility";

const owner = "Базарбаев Темурлан Аманжолович";
const user: EnrichmentResponsibleUser = { id: "person", fullName: owner, role: "employee", active: true, deleted: false };
const vacant: EnrichmentResponsibilityState = { itemId: "item", userId: null, name: null, pendingTransfer: false, unavailable: false };
const os: AuditMatch["oneC"][number] = { externalId: "os", code: "000123", name: "Стол", inventoryNumber: "1350/12345", barcode: null, responsibleName: owner, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["code"], matchedBarcodes: [] };
const mp: AuditMatch["excel"][number] = { sourceKey: "mp", sourceKind: "materials_api", rowNumber: 1, nomenclature: "Стол", inventoryNumber: "", endingBalance: "1", oneCCode: "000123", responsibleName: owner, matchedBy: ["code"] };
function proposal(options: { state?: Partial<EnrichmentResponsibilityState>; users?: EnrichmentResponsibleUser[]; source?: "os" | "mp" | "both"; code?: string | null; number?: string; ambiguous?: boolean; reason?: "source_ambiguous" | "source_reused" | "identity_conflict"; otherOwner?: string } = {}) {
  const plan: InventoryAuditEnrichmentPlan = { rows: [{ itemId: "item", itemVersion: 1, currentName: "Местное название", nextName: "Местное название", currentCode: "000123", nextCode: "000123", eligible: !options.ambiguous, changed: false, reason: options.ambiguous ? options.reason ?? "source_ambiguous" : "unchanged" }], counts: { ready: 0, unchanged: options.ambiguous ? 0 : 1, skipped: options.ambiguous ? 1 : 0 } };
  const evidence: AuditMatch = { itemId: "item", itemName: "Стол", siteNumber: options.number ?? "TMP-2026-TEST", siteOneCCode: options.code === undefined ? "000123" : options.code, siteBarcodes: [], numberKind: "temporary", itemVersion: 1, result: "matched", source: null, oneC: options.source === "mp" ? [] : [os], excel: options.source === "mp" || options.source === "both" ? [{ ...mp, responsibleName: options.otherOwner ?? owner }] : [] };
  addOneCResponsibilityProposals(plan, [evidence], new Map([["os", owner]]), options.users ?? [user], [{ ...vacant, ...options.state }]);
  return plan;
}
for (const source of ["os", "mp", "both"] as const) {
  test(`a full saved ${source} code assigns a vacant card to any matching responsible account`, () => {
    const plan = proposal({ source });
    assert.equal(plan.rows[0].responsibility?.nextUserId, "person");
    assert.equal(plan.rows[0].responsibility?.status, "ready");
    assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  });
  test(`an existing ${source} assignment is preserved even when source names differ`, () => {
    const p = proposal({ source, state: { userId: "existing", name: "Другой человек" } }).rows[0].responsibility!;
    assert.equal(p.changed, false);
    assert.equal(p.nextUserId, "existing");
    assert.equal(p.status, "unchanged");
  });
}
test("a complete inventory number assigns without any saved code", () => {
  assert.equal(proposal({ code: null, number: "1350 / 12345" }).rows[0].responsibility?.status, "ready");
  assert.equal(proposal({ code: null }).rows[0].responsibility?.changed, false);
  assert.equal(proposal({ code: "00123" }).rows[0].responsibility?.changed, false);
});
test("ambiguous source names can supply a unanimous owner without renaming the card", () => {
  const plan = proposal({ ambiguous: true });
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].nextName, plan.rows[0].currentName);
  assert.equal(plan.rows[0].nextCode, plan.rows[0].currentCode);
  assert.equal(plan.rows[0].responsibility?.status, "ready");
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  for (const reason of ["source_reused", "identity_conflict"] as const) assert.equal(proposal({ ambiguous: true, reason }).rows[0].responsibility?.changed, false);
});
test("disagreeing source owners, pending transfers, unavailable cards and duplicate accounts remain unchanged", () => {
  assert.equal(proposal({ source: "both", otherOwner: "Иной человек" }).rows[0].responsibility?.status, "ambiguous");
  assert.equal(proposal({ state: { pendingTransfer: true } }).rows[0].responsibility?.status, "pending_transfer");
  assert.equal(proposal({ state: { unavailable: true } }).rows[0].responsibility?.status, "unavailable");
  assert.equal(proposal({ users: [user, { ...user, id: "duplicate" }] }).rows[0].responsibility?.status, "user_ambiguous");
  for (const account of [{ ...user, active: false }, { ...user, deleted: true }, { ...user, fullName: "Базарбаев Темурлан" }, { ...user, fullName: "Другой Базарбаев Темурлан Аманжолович" }]) assert.equal(proposal({ users: [account] }).rows[0].responsibility?.changed, false);
});