import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { buildInventorySourceAudit, type AuditItem, type AuditMatch, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";
import { oneCNameOwnerCanIdentify, oneCResponsibleNameKey, selectOneCNameOwnerSource } from "../lib/one-c-source-name";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { workbookCell } from "./helpers/one-c-workbook";

const item: AuditItem = { id: "card", name: "Шкаф 800*400*2000", inventoryNumber: "TMP-2026-card", inventoryNumberKind: "temporary", oneCCode: null, responsibleName: "Иванов Иван Иванович", officialBarcodes: [], sourceCodes: [], version: 1 };
const asset: OneCFixedAsset = { externalId: "os-guid", code: "002", name: item.name, responsibleName: item.responsibleName!, inventoryNumber: null, barcode: null, status: "Принято к учёту", quantity: 1, initialCost: 5000, residualCost: 0, category: null, location: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null };
const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp-balance", materialGuid: "mp-guid", rowNumber: 1, oneCCode: "001", nomenclature: item.name, responsibleName: item.responsibleName, endingBalance: "1", inventoryNumber: "", unitPrice: "4000" };
const options = { exactNames: true, formattedNumbers: true, descriptionBarcodes: true };
function audit(card = item, assets = [asset], materials: ExcelSourceRow[] = []) {
  return buildInventorySourceAudit([card], assets.map(source => ({ externalId: source.externalId, asset: source })), materials, [], options).rows[0];
}

test("temporary exact full name plus nonempty complete owner confirms OS and MP independently", () => {
  for (const registry of ["os", "mp"] as const) {
    const row = audit({ ...item, name: " ШКАФ 800*400*2000 ", responsibleName: "  ИВАНОВ   Иван Иванович " }, registry === "os" ? [asset] : [], registry === "mp" ? [material] : []);
    assert.equal(classifyOneCAudit([row]).get(item.id)?.category, registry === "os" ? "fixedAssets" : "materials");
    assert.deepEqual(registry === "os" ? row.oneC[0].matchedBy : row.excel[0].matchedBy, ["name_owner"]);
  }
});

test("owner identity preserves word boundaries and rejects blank, different and partial names", () => {
  assert.notEqual(oneCResponsibleNameKey("Иван Иванов"), oneCResponsibleNameKey("Ива Ниванов"));
  assert.equal(oneCResponsibleNameKey("  Семёнов   Иван "), "семенов иван");
  for (const owner of [null, "", "  ", "Иванов Иван", "Петров Иван Иванович"]) {
    assert.equal(oneCNameOwnerCanIdentify(item, item.name, owner), false);
    assert.equal(audit({ ...item, responsibleName: owner }, [asset], [material]).source, null);
  }
  assert.equal(oneCNameOwnerCanIdentify({ ...item, responsibleName: null }, item.name, null), false);
  assert.equal(oneCNameOwnerCanIdentify({ ...item, inventoryNumber: "100", inventoryNumberKind: "official" }, item.name, item.responsibleName), false);
  assert.equal(oneCNameOwnerCanIdentify({ ...item, oneCCode: "saved" }, item.name, item.responsibleName), false);
});

test("dimensions are not identifiers and bare equal product names never confirm", () => {
  assert.equal(audit({ ...item, responsibleName: null }, [{ ...asset, responsibleName: null }], [{ ...material, responsibleName: null }]).source, null);
  assert.equal(oneCNameOwnerCanIdentify(item, "Шкаф 800*400*2001", item.responsibleName), false);
});

test("automatic selection is stable across registers and retains balances of the selected material", () => {
  const secondBalance = { ...material, sourceKey: "mp-balance-2", rowNumber: 2 };
  for (const materials of [[material, secondBalance], [secondBalance, material]]) {
    const row = audit(item, [asset], materials);
    assert.equal(row.oneC.length, 0);
    assert.equal(row.excel.length, 2);
    assert.equal(classifyOneCAudit([row]).get(item.id)?.category, "materials");
  }
  assert.equal(audit(item, [{ ...asset, code: "000", status: "Не в учёте" }], [material]).source, "excel");
  assert.equal(audit(item, [{ ...asset, code: "000", initialCost: 0 }], [material]).source, "excel");
  assert.equal(audit(item, [{ ...asset, code: "000", initialCost: 6000, quantity: 2 }], [material]).source, "excel");
});

test("full saved code, barcode and formatted number outrank same-name owner candidates", () => {
  const byCode = audit({ ...item, oneCCode: "002" }, [asset], [material]);
  assert.deepEqual(byCode.oneC[0].matchedBy, ["code"]);
  assert.equal(byCode.excel.length, 0);
  const numbered = { ...asset, name: "Other source", inventoryNumber: "011/00134" };
  for (const barcode of ["YUB-011/00134", "011*00134"]) {
    const row = audit({ ...item, officialBarcodes: [barcode] }, [numbered], [material]);
    assert.equal(row.oneC.length, 1);
    assert.equal(row.excel.length, 0);
    assert.equal(classifyOneCAudit([row]).get(item.id)?.fixedAssets, true);
  }
});

test("saved name_owner labels cannot replace independent owner and name verification", () => {
  const good = audit();
  for (const override of [{ siteResponsibleName: null }, { siteResponsibleName: "Other Person" }, { itemName: "Different cupboard" }]) {
    const row: AuditMatch = { ...good, ...override };
    assert.equal(classifyOneCAudit([row]).get(item.id)?.category, "possible");
  }
  const mp = audit(item, [], [material]);
  assert.equal(classifyOneCAudit([{ ...mp, excel: mp.excel.map(row => ({ ...row, responsibleName: null })) }]).get(item.id)?.category, "possible");
});

test("shared selector rejects invalid precision and gives active sources priority", () => {
  const candidates = [
    { active: false, unitPrice: "5000", code: "000", guid: "a" },
    { active: true, unitPrice: "1.123", code: "001", guid: "b" },
    { active: true, unitPrice: "2.00", code: "002", guid: "c" },
  ];
  assert.equal(selectOneCNameOwnerSource(candidates, value => value)?.code, "002");
  assert.equal(selectOneCNameOwnerSource([...candidates].reverse(), value => value)?.code, "002");
});

test("Excel confirmed and temporary sheets use verified name+owner presence", async () => {
  const { exportOneCAnalyticsExcel } = await import("../lib/server/excel/one-c-analytics-excel");
  for (const registry of ["os", "mp"] as const) {
    const good = audit(item, registry === "os" ? [asset] : [], registry === "mp" ? [material] : []);
    for (const staleOwner of [false, true]) {
      const row = staleOwner ? { ...good, siteResponsibleName: "Different Full Owner" } : good;
      const rows = [row];
      const bytes = await exportOneCAnalyticsExcel({
        analytics: { calculatedAt: "2026-10-28T00:00:00Z", assets: { total: 1, active: 1, retired: 0, other: 0, receivedAt: "2026-10-28T00:00:00Z" }, inventory: { total: 1, active: 1, quantity: 1 }, reconciliation: summarizeOneCAudit(rows, [asset.externalId], [material.sourceKey!]) },
        materials: { kind: "materials_api", batchId: "batch", receivedAt: null, snapshotAt: null, sha256: "test", rowCount: 1, materialCount: 1, positiveRows: 1, nonPositiveRows: 0 },
        rows, inventory: [{ id: item.id, quantity: 1, status: "active", oneCCode: null, responsibleName: row.siteResponsibleName }],
        assets: [{ externalId: asset.externalId, origins: ["current_registry"], asset }], materialRecords: [],
      });
      const book = new Workbook();
      await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      const expected = staleOwner ? "Нужно сверить номер" : "Найдено";
      assert.equal(workbookCell(book.getWorksheet("Совпадения 1С")!, "Результат сверки").value, expected);
      assert.equal(workbookCell(book.getWorksheet("Временные")!, "Результат сверки").value, expected);
    }
  }
});
