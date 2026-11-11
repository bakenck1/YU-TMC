import assert from "node:assert/strict";
import test from "node:test";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { InventoryAuditEnrichmentPlan, InventoryAuditEnrichmentReason } from "../lib/inventory-audit-enrichment";
import { addOneCResponsibilityProposals, type EnrichmentResponsibleUser, type EnrichmentResponsibilityState } from "../lib/one-c-enrichment-responsibility";

const owner = "Базарбаев Темурлан Аманжолович";
const user: EnrichmentResponsibleUser = { id: "person", fullName: owner, role: "employee", active: true, deleted: false };
const vacant: EnrichmentResponsibilityState = { itemId: "item", userId: null, name: null, pendingTransfer: false, unavailable: false };
const os: AuditMatch["oneC"][number] = { externalId: "os", code: "000123", name: "Стол", inventoryNumber: "1350/12345", barcode: null, responsibleName: owner, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["code"], matchedBarcodes: [] };
const mp: AuditMatch["excel"][number] = { sourceKey: "mp", sourceKind: "materials_api", rowNumber: 1, nomenclature: "Стол", inventoryNumber: "", endingBalance: "1", oneCCode: "000123", responsibleName: owner, matchedBy: ["code"] };
function proposal(options: { name?: string; nextName?: string; sourceName?: string; materialName?: string; state?: Partial<EnrichmentResponsibilityState>; users?: EnrichmentResponsibleUser[]; source?: "os" | "mp" | "both"; code?: string | null; number?: string; ambiguous?: boolean; reason?: InventoryAuditEnrichmentReason; otherOwner?: string; sourceOwner?: string } = {}) {
  const plan: InventoryAuditEnrichmentPlan = { rows: [{ itemId: "item", itemVersion: 1, currentName: options.name ?? "Local name", nextName: options.nextName ?? options.name ?? "Local name", currentCode: "000123", nextCode: "000123", eligible: !options.ambiguous, changed: false, reason: options.ambiguous ? options.reason ?? "source_ambiguous" : "unchanged" }], counts: { ready: 0, unchanged: options.ambiguous ? 0 : 1, skipped: options.ambiguous ? 1 : 0 } };
  const evidence: AuditMatch = { itemId: "item", itemName: options.name ?? os.name, siteNumber: options.number ?? "TMP-2026-TEST", siteOneCCode: options.code === undefined ? "000123" : options.code, siteBarcodes: [], numberKind: "temporary", itemVersion: 1, result: "matched", source: null, oneC: options.source === "mp" ? [] : [{ ...os, name: options.sourceName ?? os.name }], excel: options.source === "mp" || options.source === "both" ? [{ ...mp, nomenclature: options.materialName ?? mp.nomenclature, responsibleName: options.otherOwner ?? options.sourceOwner ?? owner }] : [] };
  addOneCResponsibilityProposals(plan, [evidence], new Map([["os", options.sourceOwner ?? owner]]), options.users ?? [user], [{ ...vacant, ...options.state }]);
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
test("chairs never inherit a single source owner, including grouped chairs sharing a 1C code", () => {
  for (const source of ["os", "mp", "both"] as const) {
    for (const name of ["Стул", "СТУЛ офисный", "Стулья 500 шт.", "Набор стульев", "Chair", "Office chairs", "Стул-кресло"]) {
      const plan = proposal({ source, name });
      assert.equal(plan.rows[0].responsibility?.status, "not_allowed", name);
      assert.equal(plan.rows[0].responsibility?.changed, false, name);
      assert.equal(plan.rows[0].responsibility?.nextUserId, null, name);
      assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
    }
  }
});

test("chair identity in either source or proposed name also prevents automatic assignment", () => {
  for (const names of [{ sourceName: "Стул" }, { materialName: "Стулья" }, { nextName: "Стул офисный" }]) {
    const plan = proposal({ source: "both", ...names });
    assert.equal(plan.rows[0].responsibility?.status, "not_allowed");
    assert.equal(plan.rows[0].responsibility?.changed, false);
  }
  const numberMatched = proposal({ name: "Стул", code: null, number: "1350 / 12345" });
  assert.equal(numberMatched.rows[0].responsibility?.status, "not_allowed");
});

test("an existing individual chair assignment is preserved and other furniture still receives owners", () => {
  const existing = proposal({ name: "Стул", state: { userId: "individual-owner", name: owner } });
  assert.equal(existing.rows[0].responsibility?.status, "unchanged");
  assert.equal(existing.rows[0].responsibility?.nextUserId, "individual-owner");
  assert.equal(existing.rows[0].responsibility?.changed, false);
  for (const name of ["Стол", "Шкаф", "Столешница", "Подстолье", "Монитор", "Chairman display"]) {
    assert.equal(proposal({ name }).rows[0].responsibility?.status, "ready", name);
  }
});

test("blocking a chair assignment leaves already planned name and code updates intact", () => {
  const plan: InventoryAuditEnrichmentPlan = {
    rows: [{ itemId: "item", itemVersion: 1, currentName: "Стул", nextName: "Стул офисный",
      currentCode: null, nextCode: "000123", eligible: true, changed: true, reason: "confirmed" }],
    counts: { ready: 1, unchanged: 0, skipped: 0 },
  };
  const evidence: AuditMatch = { itemId: "item", itemName: "Стул", siteNumber: "1350/12345", siteOneCCode: null,
    siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null, oneC: [os], excel: [] };
  addOneCResponsibilityProposals(plan, [evidence], new Map([["os", owner]]), [user], [vacant]);
  assert.equal(plan.rows[0].responsibility?.status, "not_allowed");
  assert.equal(plan.rows[0].responsibility?.changed, false);
  assert.equal(plan.rows[0].changed, true);
  assert.equal(plan.rows[0].nextName, "Стул офисный");
  assert.equal(plan.rows[0].nextCode, "000123");
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
});

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
});
test("a unanimous confirmed owner is independent of name length and source reuse", () => {
  for (const reason of ["source_reused", "name_invalid"] as const) {
    const plan = proposal({ ambiguous: true, reason });
    assert.equal(plan.rows[0].responsibility?.status, "ready");
    assert.equal(plan.rows[0].nextName, plan.rows[0].currentName);
    assert.equal(plan.rows[0].nextCode, plan.rows[0].currentCode);
    assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
    assert.equal(proposal({ ambiguous: true, reason, code: null }).rows[0].responsibility?.changed, false);
  }
});
test("changed, missing, ineligible or conflicting card identities cannot be revived", () => {
  for (const reason of ["item_not_found", "item_changed", "item_ineligible", "identity_conflict", "identity_missing", "sources_missing", "shared_number_conflict"] as const) {
    const plan = proposal({ ambiguous: true, reason });
    assert.equal(plan.rows[0].responsibility?.changed, false);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
  }
});
test("a separate trailing accounting MOL marker does not become part of the full name", () => {
  for (const source of ["os", "mp", "both"] as const) for (const marker of [" мол", "\nмол", "\r\nМОЛ", " (МОЛ)", "( мол )", "; МОЛ", ", мол "]) {
    assert.equal(proposal({ source, sourceOwner: owner + marker }).rows[0].responsibility?.status, "ready");
  }
  assert.equal(proposal({ sourceOwner: "Аманжолович Базарбаев Темурлан\nмол" }).rows[0].responsibility?.status, "ready");
  assert.equal(proposal({ users: [user, { ...user, id: "duplicate", fullName: owner + " (МОЛ)" }] }).rows[0].responsibility?.status, "user_ambiguous");
  for (const sourceOwner of [owner + "мол", owner + " другой сотрудник", "Базарбаев Темурлан мол", "мол"]) {
    assert.equal(proposal({ sourceOwner }).rows[0].responsibility?.changed, false);
  }
});
test("disagreeing source owners, pending transfers, unavailable cards and duplicate accounts remain unchanged", () => {
  assert.equal(proposal({ source: "both", otherOwner: "Иной человек" }).rows[0].responsibility?.status, "ambiguous");
  assert.equal(proposal({ state: { pendingTransfer: true } }).rows[0].responsibility?.status, "pending_transfer");
  assert.equal(proposal({ state: { unavailable: true } }).rows[0].responsibility?.status, "unavailable");
  assert.equal(proposal({ users: [user, { ...user, id: "duplicate" }] }).rows[0].responsibility?.status, "user_ambiguous");
  for (const account of [{ ...user, active: false }, { ...user, deleted: true }, { ...user, fullName: "Базарбаев Темурлан" }, { ...user, fullName: "Другой Базарбаев Темурлан Аманжолович" }]) assert.equal(proposal({ users: [account] }).rows[0].responsibility?.changed, false);
});
