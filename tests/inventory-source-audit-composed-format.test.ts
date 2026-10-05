import assert from "node:assert/strict";
import test from "node:test";
import { auditNeedsReview, buildInventorySourceAudit, type AuditItem, type AuditOneCRow, type ExcelSourceRow } from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

function item(inventoryNumber: string, officialBarcodes: string[] = []): AuditItem {
  return { id: "site", name: "Ноутбук", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes, version: 1 };
}

function source(inventoryNumber: string | null, name = "Ноутбук", barcode: string | null = null): AuditOneCRow {
  return { externalId: "source", asset: { externalId: "source", code: "00003254", inventoryNumber, name, barcode, status: "Принято к учёту" } as OneCFixedAsset };
}

function excel(inventoryNumber: string): ExcelSourceRow {
  return { rowNumber: 2, inventoryNumber, nomenclature: `Ноутбук №${inventoryNumber}`, oneCCode: "00003254", endingBalance: "1" };
}

test("audit composes internal digit whitespace and a missing slash in both directions", () => {
  for (const whitespace of [" ", "\u00a0", "\u202f", "\t"]) {
    for (const [siteNumber, sourceNumber] of [
      ["2411/00388", `2411${whitespace}00388`],
      [`24${whitespace}11/00${whitespace}388`, "241100388"],
      ["241100388", `24${whitespace}11/00${whitespace}388`],
      [`2411${whitespace}00388`, "2411/00388"],
    ]) {
      const row = buildInventorySourceAudit([item(siteNumber)], [source(sourceNumber)], [excel(sourceNumber)], []).rows[0];
      assert.equal(row.source, "1c+excel", JSON.stringify({ siteNumber, sourceNumber }));
      assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
      assert.ok(row.excel[0].matchedBy?.includes("number_spaces"));
      assert.equal(row.oneC[0].inventoryNumber, sourceNumber);
      assert.equal(row.excel[0].matchedInventoryNumber, sourceNumber);
      assert.equal(auditNeedsReview(row), true);
    }
  }
});

test("composed format matching works through descriptions and official barcodes without replacing evidence", () => {
  const spaced = "2411\u202f00388";
  const row = buildInventorySourceAudit([item("OTHER", ["*YUB-2411/00388*"])], [source(null, `Ноутбук №${spaced}`)], [excel(spaced)], []).rows[0];
  assert.equal(row.source, "1c+excel");
  assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
  assert.deepEqual(row.oneC[0].matchedBarcodes, ["*YUB-2411/00388*"]);
  assert.deepEqual(row.excel[0].matchedBarcodes, ["*YUB-2411/00388*"]);
  assert.equal(row.oneC[0].name, `Ноутбук №${spaced}`);
});

test("composing formats preserves zeros, dashes, complete suffixes, and an existing slash boundary", () => {
  for (const [siteNumber, sourceNumber] of [
    ["02411/00388", "2411 00388"],
    ["2411/00388", "2411 0388"],
    ["2411-00388", "2411 00388"],
    ["2411/00388", "2411 00388-0001"],
    ["2411/00388-0001", "2411 00388"],
    ["2411/00388", "24 110/0388"],
    ["2411/00388", "24/11/00 388"],
    ["2411/00388", "X2411 00388"],
  ]) {
    const row = buildInventorySourceAudit([item(siteNumber)], [source(sourceNumber)], [excel(sourceNumber)], []).rows[0];
    assert.equal(row.source, null, JSON.stringify({ siteNumber, sourceNumber }));
  }
});
