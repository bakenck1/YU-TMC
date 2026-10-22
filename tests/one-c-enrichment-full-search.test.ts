import assert from "node:assert/strict";
import test from "node:test";
import { buildInventorySourceAudit, type AuditItem } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { addOneCResponsibilityProposals, type EnrichmentResponsibleUser } from "../lib/one-c-enrichment-responsibility";

const item: AuditItem = { id: "item", name: "Наше название", inventoryNumber: "1350/14444", inventoryNumberKind: "official", officialBarcodes: ["YUB-1350/14444"], sourceCodes: [], oneCCode: null, version: 1 };
const asset = (name: string): OneCFixedAsset => ({ externalId: "asset", name, inventoryNumber: null, barcode: null, code: "00012", category: null, location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: null, acceptedAt: null, updatedAt: null });
function planFor(name: string, it = false) {
  const audit = buildInventorySourceAudit([item], [{ externalId: "asset", asset: asset(name), origins: ["current_registry"] }], [], [], { descriptionBarcodes: true });
  return { evidence: audit.rows, plan: buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...item, itemSection: it ? "it" : "general" }], { allowDescriptionIdentity: true, includeIt: true }) };
}

for (const name of ["Принтер №1350/14444", "Принтер 1350/14444", "Принтер *YUB-1350/14444*", "Принтер штрихкод: YUB-1350/14444", "Принтер 1350 / 14444 (модель 50000)"]) {
  test(`global search identifies a full source token: ${name}`, () => {
    const { plan } = planFor(name);
    assert.equal(plan.counts.ready, 1);
    assert.equal(plan.rows[0].nextName, name);
    assert.equal(plan.rows[0].nextCode, "00012");
    assert.match(plan.rows[0].identityEvidence!, /1350\/14444/);
  });
}
for (const name of ["Принтер 1350/14444-99", "Принтер 1350/144440", "Принтер *YUB-1350/14444* и *YUB-1350/99999*", "Принтер №1350/14444 №1350/99999", "Принтер 01350/14444", "Принтер 135014444", "Принтер HP14444"]) {
  test(`global search never turns a fragment or contradictory identity into an update: ${name}`, () => {
    assert.equal(planFor(name).plan.counts.ready, 0);
  });
}
test("global plan includes IT and legacy plans retain their original identity requirements", () => {
  assert.equal(planFor("Принтер №1350/14444", true).plan.counts.ready, 1);
  const { evidence } = planFor("Принтер №1350/14444");
  assert.equal(buildInventoryAuditEnrichmentPlan(evidence, [{ ...item, itemSection: "general" }]).rows[0].reason, "identity_missing");
});

test("a full official barcode can differ from the inventory number, but cannot hide a conflicting supplied number", () => {
  const ownItem = { ...item, officialBarcodes: ["ABC123456"] };
  const source: OneCFixedAsset = { ...asset("Принтер *ABC123456*"), barcode: "ABC123456" };
  const audit = buildInventorySourceAudit([ownItem], [{ externalId: "asset", asset: source }], [], [], { descriptionBarcodes: true });
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...ownItem, itemSection: "general" }], { allowDescriptionIdentity: true });
  assert.equal(plan.counts.ready, 1);
  source.inventoryNumber = "1350/99999";
  const conflicting = buildInventorySourceAudit([ownItem], [{ externalId: "asset", asset: source }], [], [], { descriptionBarcodes: true });
  assert.equal(buildInventoryAuditEnrichmentPlan(conflicting.rows, [{ ...ownItem, itemSection: "general" }], { allowDescriptionIdentity: true }).counts.ready, 0);
  source.inventoryNumber = null;
  source.barcode = null;
  const descriptionOnly = buildInventorySourceAudit([ownItem], [{ externalId: "asset", asset: source }], [], [], { descriptionBarcodes: true });
  assert.equal(buildInventoryAuditEnrichmentPlan(descriptionOnly.rows, [{ ...ownItem, itemSection: "general" }], { allowDescriptionIdentity: true }).counts.ready, 1);
});

const user = (id: string, fullName: string): EnrichmentResponsibleUser => ({ id, fullName, role: "employee", active: true, deleted: false });
const people = [user("bau", "Садыков Бауыржан Анесович"), user("ermek", "Нурмаганбет Ермек Талантович")];
function responsibility(source: string, users = people, pendingTransfer = false) {
  const data = planFor("Принтер №1350/14444");
  addOneCResponsibilityProposals(data.plan, data.evidence, new Map([["asset", source]]), users, [{ itemId: item.id, userId: "old", name: "Текущий сотрудник", pendingTransfer, unavailable: false }]);
  return data.plan;
}
for (const source of ["Бауыржан Анесович", "Садыков Бауыржан Анесович", "  Талантович Нурмаганбет Ермек "]) {
  test(`only an allowed uniquely identified person may be assigned: ${source}`, () => {
    const p = responsibility(source).rows[0].responsibility!;
    assert.equal(p.changed, true);
    assert.equal(p.nextUserId, source.includes("Бауыржан") ? "bau" : "ermek");
  });
}
for (const source of ["Другой сотрудник", "Бауыржан", "Ермек Талантович", "Другой Бауыржан Анесович"]) {
  test(`other or incomplete names keep the current responsibility: ${source}`, () => {
    const p = responsibility(source).rows[0].responsibility!;
    assert.equal(p.changed, false);
    assert.equal(p.nextUserId, "old");
  });
}
test("missing, duplicate, inactive and pending-transfer identities never get assigned", () => {
  assert.equal(responsibility("Бауыржан Анесович", []).rows[0].responsibility?.status, "user_missing");
  assert.equal(responsibility("Бауыржан Анесович", [...people, user("namesake", "Другой Бауыржан Анесович")]).rows[0].responsibility?.status, "user_ambiguous");
  assert.equal(responsibility("Бауыржан Анесович", [{ ...people[0], active: false }]).rows[0].responsibility?.status, "user_missing");
  assert.equal(responsibility("Бауыржан Анесович", people, true).rows[0].responsibility?.status, "pending_transfer");
});
test("responsibility-only changes count as ready once, and matching existing owners remain unchanged", () => {
  const data = planFor("Принтер №1350/14444");
  data.plan.rows[0].changed = false;
  data.plan.counts = { ready: 0, unchanged: 1, skipped: 0 };
  addOneCResponsibilityProposals(data.plan, data.evidence, new Map([["asset", "Бауыржан Анесович"]]), people, [{ itemId: item.id, userId: null, name: null, pendingTransfer: false, unavailable: false }]);
  assert.deepEqual(data.plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(data.plan.rows[0].responsibility?.nextUserId, "bau");
});

test("explicit full 1C names map to their uniquely identified short site names", () => {
  const users = [user("bau", "Бауыржан Тынымбаев"), user("ermek", "Нурмаганбет Ермек Талантович")];
  assert.equal(responsibility("Тынымбаев Бауыржан Анесович", users).rows[0].responsibility?.nextUserId, "bau");
  assert.equal(responsibility("Нұрмағанбет Ермек Талантұлы", users).rows[0].responsibility?.nextUserId, "ermek");
  assert.equal(responsibility("Тынымбаев Бауыржан Анесович", [...users, user("namesake", "Тынымбаев Бауыржан Анесович")]).rows[0].responsibility?.status, "user_ambiguous");
  assert.equal(responsibility("Тынымбаев Бауыржан", [user("other", "Бауыржан Другой")]).rows[0].responsibility?.changed, false);
});

test("contradictory zero padding in the 1C field and name cannot silently authorize a card update", () => {
  const card = { ...item, inventoryNumber: "2411/0390", officialBarcodes: [] };
  const source = { ...asset("Ноутбук Lenovo IdeaPad №2411/00390"), inventoryNumber: "2411/0390" };
  const audit = buildInventorySourceAudit([card], [{ externalId: "asset", asset: source, origins: ["current_registry"] }], [], [], { descriptionBarcodes: true });
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general" }], { allowDescriptionIdentity: true });
  assert.equal(plan.rows[0].reason, "identity_conflict");
  assert.deepEqual(plan.rows[0].sourceDetails, [{ kind: "ОС", name: "Ноутбук Lenovo IdeaPad №2411/00390", inventoryNumber: "2411/0390", barcode: null }]);
  assert.equal(plan.rows[0].eligible, false);
  assert.equal(plan.counts.ready, 0);
  addOneCResponsibilityProposals(plan, audit.rows, new Map([["asset", "Тынымбаев Бауыржан Анесович"]]), [user("bau", "Бауыржан Тынымбаев")],
    [{ itemId: card.id, userId: null, name: null, pendingTransfer: false, unavailable: false }]);
  assert.match(plan.rows[0].searchText!, /Тынымбаев Бауыржан Анесович/u);
  assert.equal(plan.rows[0].responsibility?.changed, false);
  assert.equal(plan.rows[0].responsibility?.status, "unconfirmed");
});

test("owners of conflicting MP candidates remain searchable without authorizing an assignment", () => {
  const data = planFor("Принтер №1350/14444");
  data.plan.rows[0].eligible = false;
  data.plan.rows[0].changed = false;
  data.plan.rows[0].reason = "identity_conflict";
  data.evidence[0].excel = [{ rowNumber: 1, inventoryNumber: "different", nomenclature: "Другая запись", endingBalance: "1", responsibleName: "Нұрмағанбет Ермек Талантұлы" }];
  addOneCResponsibilityProposals(data.plan, data.evidence, new Map(), people, [{ itemId: item.id, userId: null, name: null, pendingTransfer: false, unavailable: false }]);
  assert.match(data.plan.rows[0].searchText!, /Нұрмағанбет Ермек Талантұлы/u);
  assert.equal(data.plan.rows[0].responsibility?.changed, false);
});
