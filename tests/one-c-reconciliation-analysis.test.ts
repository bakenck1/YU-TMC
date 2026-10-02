import assert from "node:assert/strict";
import test from "node:test";

import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import {
  analyzeOneCFixedAsset,
  classifyOneCFixedAsset,
  createOneCIdentifierIndex,
  matchOneCFixedAssetIdentifiers,
  softInventoryNumberComparisonKey,
} from "../lib/one-c-reconciliation";

const asset = (changes: Partial<OneCFixedAsset> = {}): OneCFixedAsset => ({
  externalId: "11111111-1111-4111-8111-111111111111",
  code: "0001",
  inventoryNumber: "INV/001-2",
  barcode: null,
  name: "Ноутбук",
  category: "Вычислительная техника",
  location: "АУП",
  status: "Принято к учёту",
  responsibleName: "Иванов И.И.",
  responsibleExternalId: null,
  quantity: 1,
  residualCost: 100,
  acceptedAt: null,
  updatedAt: null,
  ...changes,
});

const items = [
  { id: "item-a", inventoryNumber: "inv/001-2", officialBarcodes: ["INV/001-2"] },
  { id: "item-b", inventoryNumber: "OTHER-2", officialBarcodes: ["*OTHER-2*"] },
];

test("indexed matching preserves conflicts, official aliases, fallback barcodes and weak suggestions", () => {
  const candidates = [
    ...items,
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", inventoryNumber: "INV/001-2", oneCCode: " 0001 ", sourceCodes: ["OLD-1", "OLD-1"], officialBarcodes: ["*OTHER-2*", "INVALID_日本"] },
    { id: "item-empty", inventoryNumber: "", oneCCode: null },
  ];
  const index = createOneCIdentifierIndex(candidates);
  for (const inventoryNumber of [null, "", "INV/001-2", "INV0012", "OTHER-2", "---", "NEW-123"]) {
    for (const barcode of [null, "*YUB-INV/001-2*", "*OTHER-2*", "YUI-AAAAAAAABBBB4CCC", "INVALID_日本"]) {
      for (const code of [null, "0001", "old-1", "UNKNOWN"]) {
        for (const linkedItemId of [null, "item-a", "absent-item"]) {
          const row = asset({ inventoryNumber, barcode, code });
          assert.deepEqual(
            matchOneCFixedAssetIdentifiers(row, { items: candidates, index, linkedItemId }),
            matchOneCFixedAssetIdentifiers(row, { items: candidates, linkedItemId }),
          );
        }
      }
    }
  }
});

test("a full 6552-row import reuses normalized identifiers rather than rescanning site items", () => {
  let reads = 0;
  const candidates = Array.from({ length: 1430 }, (_, number) => ({
    id: `item-${number}`, get inventoryNumber() { reads++; return `1350/${number}`; },
    oneCCode: String(number).padStart(9, "0"), officialBarcodes: [`1350/${number}`],
  }));
  const index = createOneCIdentifierIndex(candidates);
  const initialReads = reads;
  for (let number = 0; number < 6552; number++) {
    const match = matchOneCFixedAssetIdentifiers(asset({ inventoryNumber: `1350/${number}`, code: String(number).padStart(9, "0"), barcode: `1350/${number}` }), { items: candidates, index });
    assert.equal(match.itemId, number < 1430 ? `item-${number}` : null);
  }
  assert.equal(reads, initialReads);
});

test("classifies movable assets and excludes real estate, software, documentation and adjustments", () => {
  assert.deepEqual(classifyOneCFixedAsset(asset()), { kind: "physical_movable", reason: null });
  for (const [name, reason] of [
    ["Здание учебного корпуса", "real_estate"],
    ["Лицензия на программное обеспечение", "software"],
    ["Проектная документация", "documentation"],
    ["Бухгалтерская корректировка", "accounting_adjustment"],
  ] as const) {
    assert.deepEqual(classifyOneCFixedAsset(asset({ name })), { kind: "non_physical", reason });
  }
});

test("exact inventory comparison preserves separators while the soft key is suggestion-only", () => {
  assert.equal(matchOneCFixedAssetIdentifiers(asset(), { items }).status, "inventory_candidate");
  const soft = matchOneCFixedAssetIdentifiers(asset({ inventoryNumber: "INV0012" }), { items });
  assert.equal(soft.status, "possible_match");
  assert.equal(soft.blocking, false);
  assert.equal(softInventoryNumberComparisonKey(" INV/001-2 "), "inv0012");
});

test("empty barcode is neutral and Code 39 framing plus legacy prefix use existing parser semantics", () => {
  assert.equal(matchOneCFixedAssetIdentifiers(asset({ barcode: null }), { items }).status, "inventory_candidate");
  assert.equal(matchOneCFixedAssetIdentifiers(asset({ barcode: " *YUB-INV/001-2* " }), { items }).status, "strong_candidate");
});

test("number and barcode resolving to different items produce a blocking conflict", () => {
  const result = matchOneCFixedAssetIdentifiers(asset({ barcode: "*OTHER-2*" }), { items });
  assert.equal(result.status, "barcode_conflict");
  assert.equal(result.blocking, true);
  assert.deepEqual(result.inventoryItemIds, ["item-a"]);
  assert.deepEqual(result.barcodeItemIds, ["item-b"]);
});

test("linked GUID handles exact match, changed number, and foreign identifiers", () => {
  assert.equal(matchOneCFixedAssetIdentifiers(asset(), { items, linkedItemId: "item-a" }).status, "match_ok");
  assert.equal(matchOneCFixedAssetIdentifiers(asset({ inventoryNumber: "NEW-1" }), { items, linkedItemId: "item-a" }).status, "linked_number_changed");
  assert.equal(matchOneCFixedAssetIdentifiers(asset({ inventoryNumber: "OTHER-2" }), { items, linkedItemId: "item-a" }).status, "inventory_number_conflict");
});

test("invalid Code 39 warns on an exact match, while residual value states remain distinct", () => {
  const invalid = analyzeOneCFixedAsset(asset({ barcode: "КИРИЛЛИЦА" }), {
    items, selectedRoomId: "room", selectedItemType: "equipment",
  });
  assert.equal(invalid.identifiers.barcodeState, "invalid");
  assert.ok(invalid.issues.some((entry) => entry.code === "invalid_one_c_barcode" && entry.severity === "warning"));
  assert.equal(invalid.identifiers.itemId, "item-a");

  const missing = analyzeOneCFixedAsset(asset({ residualCost: null }), { items });
  assert.ok(!missing.issues.some((entry) => entry.code.includes("residual_value")));
  const zero = analyzeOneCFixedAsset(asset({ residualCost: 0 }), { items });
  assert.ok(zero.issues.some((entry) => entry.code === "zero_residual_value_unconfirmed" && entry.severity === "warning"));
  const negative = analyzeOneCFixedAsset(asset({ residualCost: -1 }), { items });
  assert.ok(negative.issues.some((entry) => entry.code === "negative_residual_value" && entry.severity === "blocking"));
});

test("analysis emits the required exclusive result and actionable issues", () => {
  assert.equal(analyzeOneCFixedAsset(asset({ inventoryNumber: null }), { items }).result, "blocked_missing_inventory_number");
  assert.equal(analyzeOneCFixedAsset(asset({ name: "Здание" }), { items }).result, "candidate_inventory_number");
  assert.equal(analyzeOneCFixedAsset(asset({ name: "Здание", inventoryNumber: "NEW" }), { items }).result, "excluded_non_physical");
  assert.equal(analyzeOneCFixedAsset(asset({ inventoryNumber: "NEW" }), { items }).result, "blocked_missing_room");
  assert.equal(analyzeOneCFixedAsset(asset({ inventoryNumber: "NEW" }), { items, selectedRoomId: "room" }).result, "blocked_unsupported_type");
  assert.equal(analyzeOneCFixedAsset(asset({ inventoryNumber: "NEW" }), {
    items, selectedRoomId: "room", selectedItemType: "equipment",
  }).result, "new_publishable");
  assert.equal(analyzeOneCFixedAsset(asset({ quantity: 2 }), { items }).result, "manual_review");
});

test("one exact GUID, 1C code, inventory number or barcode identifies an existing item independently of its name", () => {
  const existing = [{
    id: "item-a", inventoryNumber: "SITE-42", oneCCode: "0001",
    officialBarcodes: ["SITE-42"], sourceCodes: ["OLDER-CODE"],
  }];
  const differentName = asset({ name: "Совсем другое название", inventoryNumber: "NO-MATCH" });
  const byCode = matchOneCFixedAssetIdentifiers(differentName, { items: existing });
  assert.equal(byCode.itemId, "item-a");
  assert.deepEqual(byCode.matchedBy, ["code"]);

  const byNumber = matchOneCFixedAssetIdentifiers(asset({ code: "OTHER", inventoryNumber: "site-42" }), { items: existing });
  assert.deepEqual(byNumber.matchedBy, ["inventory_number"]);

  const byBarcode = matchOneCFixedAssetIdentifiers(asset({ code: "OTHER", inventoryNumber: "NO-MATCH", barcode: "*SITE-42*" }), { items: existing });
  assert.deepEqual(byBarcode.matchedBy, ["barcode"]);

  const byGuid = matchOneCFixedAssetIdentifiers(asset({ code: "OTHER", inventoryNumber: "NO-MATCH" }), { items: existing, linkedItemId: "item-a" });
  assert.deepEqual(byGuid.matchedBy, ["guid"]);

  const byOldCode = matchOneCFixedAssetIdentifiers(asset({ code: "OLDER-CODE", inventoryNumber: "NO-MATCH" }), { items: existing });
  assert.deepEqual(byOldCode.matchedBy, ["code"]);
});

test("different identifiers pointing to different items remain a conflict", () => {
  const existing = [
    { id: "item-a", inventoryNumber: "A", oneCCode: "0001" },
    { id: "item-b", inventoryNumber: "B", oneCCode: "0002" },
  ];
  const result = matchOneCFixedAssetIdentifiers(asset({ inventoryNumber: "B" }), { items: existing });
  assert.equal(result.status, "ambiguous_conflict");
  assert.equal(result.itemId, null);
  assert.equal(result.blocking, true);
});
