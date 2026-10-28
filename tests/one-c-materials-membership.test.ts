import assert from "node:assert/strict";
import test from "node:test";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit } from "../lib/inventory-source-audit";
import { summarizeOneCAudit } from "../lib/one-c-analytics";
import { getOneCMatchedCards } from "../lib/one-c-matched-cards";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";
import { Workbook } from "exceljs";
import { workbookCell } from "./helpers/one-c-workbook";

// Regression examples: six Inventory cards must remain six cards, including the shared board code.
const samples = [
  ["female", "00000012626", "манекен портновский женский от 10.12.24", 2, 29000],
  ["male", "00000012625", "манекен портновский мужской от 10.12.24", 2, 29000],
  ["board-1", "00000011482", "доска маркерная двухсторонняя с подставкой от 04.07.24", 1, 28667],
  ["board-2", "00000011482", "доска маркерная двухсторонняя с подставкой от 04.07.24", 1, 28667],
  ["chairs", "00000012056", "кресло офисное обивка из ткани от 05.09.24", 59, 15848],
  ["stools", "00000011436", "стул школьный без обивки жесткий от 03.06.2024", 6, 8960],
] as const;
function snapshot() {
  const cards = samples.map(([id, code, name, quantity, price]) => ({ id, name, inventoryNumber: `TMP-2026-${id}`, inventoryNumberKind: "temporary", oneCCode: code as string | null, responsibleName: "Сотрудник проверки", quantity: Number(quantity), unitPrice: String(price), status: "active", version: 1, sourceCodes: [] as string[], officialBarcodes: [] as string[] }));
  cards.push({ ...cards[0], id: "number-only", name: "Предмет №1350/12345", inventoryNumber: "TMP-2026-NUMBER", oneCCode: null });
  cards.push({ ...cards[0], id: "missing", name: "Не найденный предмет", inventoryNumber: "TMP-2026-MISSING", oneCCode: null });
  const assets: OneCFixedAsset[] = [...new Map(samples.map(([, code, name, , price]) => [code, { externalId: code, code, name, inventoryNumber: null, barcode: null, quantity: 1, initialCost: price, residualCost: 0, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, category: null, location: null, acceptedAt: null, updatedAt: null } satisfies OneCFixedAsset])).values()];
  assets.push({ ...assets[0], externalId: "number-source", code: "NUMBER", name: "Предмет №1350/12345", inventoryNumber: "135012345" });
  const sources = assets.map(asset => ({ externalId: asset.externalId, asset, origins: ["current_registry" as const] }));
  const rows = buildInventorySourceAudit(cards, sources, [], [], { formattedNumbers: true, descriptionBarcodes: true, exactNames: true }).rows;
  return { rows, inventory: cards, assets: sources,
    analytics: { calculatedAt: "2026-10-28T00:00:00Z", assets: { total: assets.length, active: assets.length, retired: 0, other: 0, receivedAt: "2026-10-28T00:00:00Z" }, inventory: { total: cards.length, active: cards.length, quantity: cards.reduce((sum, card) => sum + card.quantity, 0) }, reconciliation: summarizeOneCAudit(rows, assets.map(asset => asset.externalId), []) },
    materials: { kind: "materials_api" as const, batchId: null, receivedAt: null, snapshotAt: null, sha256: "empty", rowCount: 0, materialCount: 0, positiveRows: 0, nonPositiveRows: 0 }, materialRecords: [],
  };
}

test("all six confirmed temporary examples join MP individually; a missing no-code card stays unmatched", () => {
  const data = snapshot();
  const matched = getOneCMatchedCards(data).filter(card => card.group === "materials");
  for (const [id] of samples) assert.ok(matched.some(card => card.id === id));
  assert.equal(matched.filter(card => card.oneCCode === "00000011482").length, 2);
  assert.equal(matched.some(card => card.id === "number-only"), true);
  assert.equal(matched.some(card => card.id === "missing"), false);
  assert.equal(data.analytics.reconciliation.materials, 7);
  assert.equal(data.analytics.reconciliation.temporaryUnmatched, 1);
  assert.equal(data.inventory.find(card => card.id === "missing")?.oneCCode, null);
});

test("the MP worksheet includes every matched temporary card exactly once", async () => {
  const data = snapshot();
  const bytes = await exportOneCAnalyticsExcel(data);
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet("МП")!;
  const ids = Array.from({ length: sheet.rowCount - 5 }, (_, index) => workbookCell(sheet, "ID карточки", index + 6).value);
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids).size, 7);
  for (const [id] of samples) assert.ok(ids.includes(id));
  assert.equal(ids.includes("missing"), false);
});
