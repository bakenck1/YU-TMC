import assert from "node:assert/strict";
import test from "node:test";
import { buildInventorySourceAudit, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import { addOneCResponsibilityProposals } from "../lib/one-c-enrichment-responsibility";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";
import { Workbook } from "exceljs";
import { workbookCell } from "./helpers/one-c-workbook";

const item = { id: "temp", name: "Наше название", inventoryNumber: "TMP-2026-000001", inventoryNumberKind: "temporary", oneCCode: "00000123", officialBarcodes: [], sourceCodes: [], version: 1, itemSection: "general", status: "active", unitPrice: "0" };
const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "00000123", nomenclature: "Материал 1С", inventoryNumber: "", explicitInventoryNumber: null, barcode: null, endingBalance: "3", unitPrice: "1234.50" };
const options = { descriptionBarcodes: true, formattedNumbers: true, allowDescriptionIdentity: true, allowTemporaryMaterialCode: true };
function review(cards: (typeof item)[] = [item], materials = [material]) {
  const audit = buildInventorySourceAudit(cards, [], materials, [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, cards, options);
  addOneCPriceProposals(plan, audit.rows, new Map(), cards);
  return { audit, plan };
}

test("exact material code confirms a temporary card and proposes its name and price together", () => {
  const { audit, plan } = review();
  assert.equal(audit.rows[0].siteOneCCode, "00000123");
  assert.equal(classifyOneCAudit(audit.rows).get("temp")?.category, "materials");
  assert.deepEqual(summarizeOneCAudit(audit.rows, [], ["mp"]), { total: 1, fixedAssets: 0, materials: 1, both: 0, possible: 0, missing: 0, temporary: 1, temporaryUnmatched: 0, temporaryFound: 1, temporaryPossible: 0, assetsWithoutCandidate: 0, materialBalancesWithoutCandidate: 0 });
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].identityMethod, "material_code");
  assert.equal(plan.rows[0].nextName, material.nomenclature);
  assert.equal(plan.rows[0].price?.nextUnitPrice, "1234.50");
});

test("one material code may update several temporary cards without pretending they are one physical item", () => {
  const { plan } = review([item, { ...item, id: "other", inventoryNumber: "TMP-2026-000002" }]);
  assert.equal(plan.counts.ready, 2);
  assert.ok(plan.rows.every(row => row.nextName === material.nomenclature && row.price?.nextUnitPrice === "1234.50"));
});

test("missing and differing codes, including leading zeros, do not confirm temporary cards", () => {
  for (const code of ["", "123", "00000124"]) {
    const { audit, plan } = review([{ ...item, oneCCode: code }]);
    assert.equal(classifyOneCAudit(audit.rows).get("temp")?.category, "missing");
    assert.equal(plan.rows[0].eligible, false);
  }
});

test("permanent cards and historical enrichment retain the full-identifier requirement", () => {
  const card = { ...item, inventoryNumber: "999/999", inventoryNumberKind: "official" };
  assert.equal(review([card]).plan.rows[0].eligible, false);
  const { audit } = review();
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [item], { allowDescriptionIdentity: true, formattedNumbers: true }).rows[0].eligible, false);
});

test("same-code balances with different prices preserve price while consistent names can update", () => {
  const { plan } = review([item], [material, { ...material, rowNumber: 2, sourceKey: "mp2", unitPrice: "999" }]);
  assert.equal(plan.rows[0].nextName, material.nomenclature);
  assert.equal(plan.rows[0].price?.status, "ambiguous");
  assert.equal(plan.rows[0].price?.nextUnitPrice, "0.00");
  assert.equal(review([item], [material, { ...material, rowNumber: 2, nomenclature: "Другое название" }]).plan.rows[0].eligible, false);
});

test("temporary material-code proposals ignore unrelated OS and MP number candidates", () => {
  const { audit } = review();
  audit.rows[0].oneC.push({ externalId: "os", code: item.oneCCode, name: "Другая ОС", inventoryNumber: "999/999", barcode: null, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["code"], matchedBarcodes: [] });
  audit.rows[0].excel.push({ ...material, oneCCode: "OTHER", rowNumber: 2, sourceKey: "foreign", nomenclature: "Другой материал", unitPrice: "999999" });
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
  addOneCPriceProposals(plan, audit.rows, new Map(), [item]);
  assert.equal(plan.rows[0].nameSource, "materials_api");
  assert.equal(plan.rows[0].nextName, material.nomenclature);
  assert.equal(plan.rows[0].price?.nextUnitPrice, "1234.50");
  assert.equal(classifyOneCAudit(audit.rows).get("temp")?.category, "both");
});

test("zero balance and legacy Excel are not evidence of the current material-code stock", () => {
  for (const source of [{ ...material, endingBalance: "0" }, { ...material, sourceKind: undefined }]) {
    const { audit, plan } = review([item], [source]);
    assert.equal(classifyOneCAudit(audit.rows).get("temp")?.materials, false);
    assert.equal(plan.rows[0].eligible, false);
  }
});

test("code-only nomenclature matching never assigns a physical card's responsible person", () => {
  const { audit, plan } = review([item], [{ ...material, responsibleName: "Бауыржан Анесович" }]);
  addOneCResponsibilityProposals(plan, audit.rows, new Map(), [{ id: "user", fullName: "Бауыржан Анесович", active: true, deleted: false, role: "employee" }], [{ itemId: item.id, userId: null, name: null, pendingTransfer: false, unavailable: false }]);
  assert.equal(plan.rows[0].responsibility?.changed, false);
});

test("Excel shows a code-matched temporary card as found in MP on both Inventory sheets", async () => {
  const { audit } = review();
  const snapshot = { analytics: { calculatedAt: "2026-10-23T05:00:00Z", assets: { total: 0, active: 0, retired: 0, other: 0, receivedAt: null }, inventory: { total: 1, active: 1, quantity: 1 }, reconciliation: summarizeOneCAudit(audit.rows, [], ["mp"]) }, materials: { kind: "materials_api" as const, batchId: "batch", receivedAt: null, snapshotAt: null, sha256: "test", rowCount: 1, materialCount: 1, positiveRows: 1, nonPositiveRows: 0 }, rows: audit.rows, inventory: [{ id: item.id, quantity: 1, status: "active", oneCCode: item.oneCCode, unitPrice: "0", responsibleName: null }], assets: [], materialRecords: [] };
  const bytes = await exportOneCAnalyticsExcel(snapshot);
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  for (const name of ["Совпадения 1С", "Временные"]) {
    assert.equal(workbookCell(workbook.getWorksheet(name)!, "Результат сверки").value, "Найдено");
    assert.equal(workbookCell(workbook.getWorksheet(name)!, "Раздел 1С").value, "МП");
  }
  assert.equal(workbook.getWorksheet("Не найдено в 1С")!.rowCount, 5);
});
