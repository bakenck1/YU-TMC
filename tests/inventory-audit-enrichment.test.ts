import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "../lib/inventory-audit-enrichment";
import type { AuditMatch } from "../lib/inventory-source-audit";

function fixture(): { item: InventoryAuditEnrichmentItem; row: AuditMatch } {
  return {
    item: { id: "site-1", name: "Ноутбук", inventoryNumber: "2411/00388", officialBarcodes: ["2411/00388"], oneCCode: null, version: 7, itemSection: "general", archivedAt: null },
    row: {
      itemId: "site-1", itemName: "Ноутбук", siteNumber: "2411/00388", siteBarcodes: [{ value: "2411/00388", kind: "official" }], numberKind: "official", itemVersion: 7, result: "matched", source: "1c+excel",
      oneC: [{ externalId: "asset-1", code: "00003254", inventoryNumber: "241100388", barcode: null, name: "Ноутбук Lenovo IdeaPad №2411/00388", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["number_without_slash"], matchedBarcodes: ["2411/00388"] }],
      excel: [{ rowNumber: 14, inventoryNumber: "2411/00388", nomenclature: "Ноутбук Lenovo №2411/00388", oneCCode: "00003254", endingBalance: "1", inventoryReferences: [{ inventoryNumber: "2411/00388" }], matchedBy: ["site_number"] }],
    },
  };
}

test("confirmed screenshot identifiers use the 1C name and preserve every code zero", () => {
  const { item, row } = fixture();
  const before = JSON.stringify({ item, row });
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].nextName, "Ноутбук Lenovo IdeaPad №2411/00388");
  assert.equal(plan.rows[0].nextCode, "00003254");
  assert.equal(plan.rows[0].nameSource, "1c");
  assert.equal(plan.rows[0].codeStatus, "confirmed");
  assert.equal(plan.rows[0].externalId, "asset-1");
  assert.equal(plan.rows[0].excelRowNumber, 14);
  assert.equal(JSON.stringify({ item, row }), before, "Planning must never mutate saved evidence or live items");
});

test("selected-batch 1C evidence and Excel can confirm the existing card", () => {
  const { item, row } = fixture();
  row.oneC[0].origins = ["selected_batch"];
  const before = JSON.stringify({ item, row });
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(plan.rows[0].reason, "confirmed");
  assert.equal(plan.rows[0].nextName, row.oneC[0].name);
  assert.equal(plan.rows[0].nextCode, "00003254");
  assert.equal(plan.rows[0].missingSources, undefined);
  assert.equal(JSON.stringify({ item, row }), before);
});

test("identical selected and current copies of one 1C identity confirm one update", () => {
  const { item, row } = fixture();
  row.oneC.push({ ...row.oneC[0], origins: ["selected_batch"] });
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(plan.rows[0].externalId, "asset-1");
});

type OneCMatch = AuditMatch["oneC"][number];
const divergentCopies: [string, (entry: OneCMatch) => void][] = [
  ["code leading zeroes", (entry) => { entry.code = "3254"; }],
  ["full inventory number", (entry) => { entry.inventoryNumber = "241100389"; }],
  ["supplied slash boundary", (entry) => { entry.inventoryNumber = "24110/0388"; }],
  ["full inventory suffix", (entry) => { entry.inventoryNumber = "241100388-97"; }],
  ["barcode", (entry) => { entry.barcode = "2411/00389"; }],
  ["rejected barcode versus an absent barcode", (entry) => { entry.barcode = "TMP-123"; }],
  ["proposed name", (entry) => { entry.name = "Ноутбук Lenovo другая запись"; }],
];
for (const [label, mutate] of divergentCopies) {
  test(`different selected/current ${label} copies cannot choose a preferred 1C version`, () => {
    for (const reverse of [false, true]) {
      const { item, row } = fixture();
      const selected: OneCMatch = { ...row.oneC[0], origins: ["selected_batch"] };
      mutate(selected);
      row.oneC.push(selected);
      if (reverse) row.oneC.reverse();
      const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
      assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
      assert.equal(plan.rows[0].reason, "source_ambiguous");
      assert.equal(plan.rows[0].nextName, item.name);
      assert.equal(plan.rows[0].nextCode, item.oneCCode);
    }
  });
}

test("a rejected structured number cannot disappear beside a barcode-only copy", () => {
  for (const reverse of [false, true]) {
    const { item, row } = fixture();
    row.oneC[0].inventoryNumber = null;
    row.oneC[0].barcode = "2411/00388";
    row.oneC.push({ ...row.oneC[0], inventoryNumber: "TMP-123", origins: ["selected_batch"] });
    if (reverse) row.oneC.reverse();
    const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
    assert.equal(plan.rows[0].reason, "source_ambiguous");
  }
});

test("both absent sources retain the missing-source diagnostic and skip", () => {
  const { item, row } = fixture();
  row.oneC = [];
  row.excel = [];
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.equal(plan.rows[0].reason, "sources_missing");
  assert.deepEqual(plan.rows[0].missingSources, ["1c", "excel"]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
});

test("empty, missing, and unsupported 1C origins permit only a safe Excel name", () => {
  for (const origins of [[], undefined, ["unsupported_source"]]) {
    const { item, row } = fixture();
    row.oneC[0].origins = origins as OneCMatch["origins"];
    const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
    assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
    assert.equal(plan.rows[0].nextName, row.excel[0].nomenclature);
    assert.equal(plan.rows[0].nextCode, item.oneCCode);
    assert.equal(plan.rows[0].nameSource, "excel");
    assert.equal(plan.rows[0].codeStatus, "sources_missing");
    assert.equal(plan.rows[0].externalId, undefined);
  }
});

test("internal digit spaces and separator spaces retain the same complete identifier", () => {
  for (const value of ["2411 / 00388", "24 11/00 388", "2411\u00a000388", "２４１１/００３８８"]) {
    const { item, row } = fixture();
    row.oneC[0].inventoryNumber = value;
    assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, true, value);
  }
});

test("an existing equal code can receive a confirmed authoritative name and then be unchanged", () => {
  const { item, row } = fixture();
  item.oneCCode = "00003254";
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).counts.ready, 1);
  item.name = row.oneC[0].name;
  row.itemName = item.name;
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
  assert.equal(plan.rows[0].changed, false);
});

test("a temporary site number can use a verified official barcode, never a local group barcode", () => {
  const { item, row } = fixture();
  item.inventoryNumber = row.siteNumber = "TMP-2026-001";
  row.numberKind = "temporary";
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, true);
  item.officialBarcodes = [];
  row.siteBarcodes = [{ value: "2411/00388", kind: "local" }];
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, false);
});

type Mutation = (value: ReturnType<typeof fixture>) => void;
type CodeStatus = NonNullable<ReturnType<typeof buildInventoryAuditEnrichmentPlan>["rows"][number]["codeStatus"]>;
const nameOnly: [string, Mutation, CodeStatus][] = [
  ["missing Excel", ({ row }) => { row.excel = []; }, "sources_missing"],
  ["missing Excel code", ({ row }) => { row.excel[0].oneCCode = null; }, "code_missing"],
  ["missing 1C code", ({ row }) => { row.oneC[0].code = null; }, "code_missing"],
  ["code mismatch", ({ row }) => { row.excel[0].oneCCode = "00003255"; }, "code_conflict"],
  ["lost code zeroes", ({ row }) => { row.excel[0].oneCCode = "3254"; }, "code_conflict"],
  ["existing conflicting site code", ({ item }) => { item.oneCCode = "00009999"; }, "code_conflict"],
  ["overlong agreed codes", ({ row }) => { row.oneC[0].code = row.excel[0].oneCCode = "0".repeat(65); }, "code_conflict"],
  ["contradictory Excel complete reference", ({ row }) => { row.excel[0].sourceInventoryNumber = "2411/00388-00389"; }, "identity_conflict"],
  ["contradictory Excel description", ({ row }) => { row.excel[0].nomenclature = "Монитор №2411/00389"; }, "identity_conflict"],
  ["missing Excel complete identifier", ({ row }) => { row.excel[0].inventoryNumber = ""; row.excel[0].inventoryReferences = []; }, "identity_missing"],
  ["multiple Excel candidates with different codes", ({ row }) => { row.excel.push({ ...row.excel[0], rowNumber: 15, oneCCode: "00003255" }); }, "source_ambiguous"],
  ["multiple Excel rows even with the same code", ({ row }) => { row.excel.push({ ...row.excel[0], rowNumber: 15 }); }, "source_ambiguous"],
  ["invalid Excel row number", ({ row }) => { row.excel[0].rowNumber = 0; }, "source_ambiguous"],
];
for (const [label, mutate, codeStatus] of nameOnly) {
  test(`a safe 1C name remains eligible with ${label}, without changing the code`, () => {
    for (const origin of ["current_registry", "selected_batch"] as const) {
      for (const existingCode of [null, "00009999"]) {
        const value = fixture();
        value.item.oneCCode = existingCode;
        mutate(value);
        for (const entry of value.row.oneC) entry.origins = [origin];
        const before = JSON.stringify(value);
        const plan = buildInventoryAuditEnrichmentPlan([value.row], [value.item]);
        assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
        assert.equal(plan.rows[0].nextName, value.row.oneC[0].name);
        assert.equal(plan.rows[0].nextCode, value.item.oneCCode);
        assert.equal(plan.rows[0].nameSource, "1c");
        assert.equal(plan.rows[0].codeStatus, codeStatus);
        assert.equal(JSON.stringify(value), before);
      }
    }
  });
}

const rejected: [string, Mutation][] = [
  ["archived item", ({ item }) => { item.archivedAt = "2026-10-05T00:00:00Z"; }],
  ["IT card", ({ item }) => { item.itemSection = "it"; }],
  ["changed item version", ({ item }) => { item.version++; }],
  ["changed item name even without a version bump", ({ item }) => { item.name = "Новое имя"; }],
  ["changed site number even without a version bump", ({ item }) => { item.inventoryNumber = "2411/00389"; }],
  ["changed official barcodes even without a version bump", ({ item }) => { item.officialBarcodes = ["2411/00389"]; }],
  ["structured number conflict despite matchedBy flag", ({ row }) => { row.oneC[0].inventoryNumber = "241100389"; row.oneC[0].matchedBy = ["guid", "code", "inventory_number"]; }],
  ["leading-zero identifier difference", ({ row }) => { row.oneC[0].inventoryNumber = "24110388"; }],
  ["different slash boundary", ({ row }) => { row.oneC[0].inventoryNumber = "24110/0388"; }],
  ["hyphen removed", ({ row }) => { row.oneC[0].inventoryNumber = "2411-00388"; }],
  ["suffix-only candidate", ({ row }) => { row.oneC[0].inventoryNumber = "2411/00388-97"; row.oneC[0].matchedBy = ["number_suffix"]; }],
  ["contradictory 1C barcode", ({ row }) => { row.oneC[0].barcode = "2411/00389"; }],
  ["contradictory description number", ({ row }) => { row.oneC[0].name = "Ноутбук №2411/00389"; }],
  ["missing structured 1C identity despite a marked description", ({ row }) => { row.oneC[0].inventoryNumber = null; row.oneC[0].barcode = null; }],
  ["code and name alone", ({ item, row }) => { item.inventoryNumber = row.siteNumber = "TMP-1"; item.officialBarcodes = []; row.oneC[0].inventoryNumber = null; row.oneC[0].barcode = null; }],
  ["empty 1C name", ({ row }) => { row.oneC[0].name = "   "; }],
  ["overlong 1C name", ({ row }) => { row.oneC[0].name = "А".repeat(161); }],
  ["control character in the 1C name", ({ row }) => { row.oneC[0].name = "Ноутбук\u0000"; }],
  ["multiple 1C external identities", ({ row }) => { row.oneC.push({ ...row.oneC[0], externalId: "asset-2" }); }],
  ["conflicting duplicate 1C evidence", ({ row }) => { row.oneC.push({ ...row.oneC[0], code: "00003255" }); }],
];
for (const [label, mutate] of rejected) {
  test(`enrichment skips ${label} instead of selecting or inventing a value`, () => {
    for (const origin of ["current_registry", "selected_batch"] as const) {
      const value = fixture();
      mutate(value);
      for (const entry of value.row.oneC) entry.origins = [origin];
      const plan = buildInventoryAuditEnrichmentPlan([value.row], [value.item]);
      assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
      assert.equal(plan.rows[0].eligible, false, label);
      assert.equal(plan.rows[0].changed, false, label);
      assert.ok(plan.rows[0].reason);
      assert.equal(plan.rows[0].nextName, value.item.name);
      assert.equal(plan.rows[0].nextCode, value.item.oneCCode);
    }
  });
}

test("one physical Excel row shared by two cards blocks codes but permits unique 1C names", () => {
  const first = fixture(), second = fixture();
  second.item.id = second.row.itemId = "site-2";
  second.row.oneC[0].externalId = "asset-2";
  const plan = buildInventoryAuditEnrichmentPlan([first.row, second.row], [first.item, second.item]);
  assert.deepEqual(plan.counts, { ready: 2, unchanged: 0, skipped: 0 });
  assert.ok(plan.rows.every((row) => row.nameSource === "1c" && row.codeStatus === "source_reused"));
  assert.ok(plan.rows.every((row) => row.nextName === first.row.oneC[0].name && row.nextCode === null));
});

test("one current 1C identity shared by two cards cannot update either card", () => {
  const first = fixture(), second = fixture();
  second.item.id = second.row.itemId = "site-2";
  second.row.excel[0].rowNumber = 15;
  const plan = buildInventoryAuditEnrichmentPlan([first.row, second.row], [first.item, second.item]);
  assert.equal(plan.counts.skipped, 2);
  assert.ok(plan.rows.every((row) => row.reason === "source_reused"));
});

test("a processor 1C name wins over a monitor Excel name while conflicting codes remain unset", () => {
  const { item, row } = fixture();
  item.name = row.itemName = "Монитор";
  item.inventoryNumber = row.siteNumber = "011-00118";
  item.officialBarcodes = ["011-00118"];
  row.siteBarcodes = [{ value: "011-00118", kind: "official" }];
  row.oneC[0].inventoryNumber = "011-00118";
  row.oneC[0].matchedBarcodes = ["011-00118"];
  row.oneC[0].code = "000003950";
  row.oneC[0].name = "Процессор 3.1 инв№011-00118";
  row.excel = [{ rowNumber: 9041, inventoryNumber: "011-00118", nomenclature: "монитор №011-00118 от 10.10.13г", oneCCode: "00000005003", endingBalance: "1", inventoryReferences: [{ inventoryNumber: "011-00118" }], matchedBy: ["site_number"] }];
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(plan.rows[0].nextName, "Процессор 3.1 инв№011-00118");
  assert.equal(plan.rows[0].nameSource, "1c");
  assert.equal(plan.rows[0].codeStatus, "code_conflict");
  assert.equal(plan.rows[0].nextCode, null);
});

test("a preferred name already stored is unchanged when source codes disagree", () => {
  const { item, row } = fixture();
  item.name = row.itemName = row.oneC[0].name;
  item.oneCCode = "00009999";
  row.excel[0].oneCCode = "00003255";
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].changed, false);
  assert.equal(plan.rows[0].reason, "unchanged");
  assert.equal(plan.rows[0].codeStatus, "code_conflict");
  assert.equal(plan.rows[0].nextCode, "00009999");
});

test("an explicit name marker cannot override the production structured hyphen mismatch", () => {
  const { item, row } = fixture();
  item.name = row.itemName = "Монитор";
  item.inventoryNumber = row.siteNumber = "011-00118";
  item.officialBarcodes = ["011-00118"];
  row.siteBarcodes = [{ value: "011-00118", kind: "official" }];
  row.oneC[0].inventoryNumber = "011 00118";
  row.oneC[0].matchedBarcodes = ["011-00118"];
  row.oneC[0].code = "000003950";
  row.oneC[0].name = "Процессор 3.1 инв№011-00118";
  row.excel = [{ rowNumber: 9041, inventoryNumber: "011-00118", nomenclature: "монитор №011-00118 от 10.10.13г", oneCCode: "00000005003", endingBalance: "1", inventoryReferences: [{ inventoryNumber: "011-00118" }], matchedBy: ["site_number"] }];
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
  assert.equal(plan.rows[0].reason, "identity_conflict");
  assert.equal(plan.rows[0].nextName, "Монитор");
  assert.equal(plan.rows[0].nextCode, null);
});

test("a safe Excel name is a fallback only without recognized 1C evidence and never assigns a code", () => {
  for (const existingCode of [null, "00009999"]) {
    const { item, row } = fixture();
    item.oneCCode = existingCode;
    row.oneC = [];
    row.source = "excel";
    const before = JSON.stringify({ item, row });
    const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
    assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
    assert.equal(plan.rows[0].nameSource, "excel");
    assert.equal(plan.rows[0].nextName, row.excel[0].nomenclature);
    assert.equal(plan.rows[0].nextCode, existingCode);
    assert.equal(plan.rows[0].codeStatus, "sources_missing");
    assert.equal(plan.rows[0].externalId, undefined);
    assert.equal(plan.rows[0].excelRowNumber, 14);
    assert.equal(JSON.stringify({ item, row }), before);
  }
});

const rejectedExcelFallback: [string, Mutation][] = [
  ["contradictory structured identifier", ({ row }) => { row.excel[0].inventoryNumber = "2411/00389"; }],
  ["a full range instead of the first member", ({ row }) => { row.excel[0].sourceInventoryNumber = "2411/00388-00389"; }],
  ["a contradictory extra reference", ({ row }) => { row.excel[0].inventoryReferences!.push({ inventoryNumber: "2411/00389" }); }],
  ["a contradictory explicit description", ({ row }) => { row.excel[0].nomenclature = "Монитор №2411/00389"; }],
  ["a missing complete identifier despite the matchedBy flag", ({ row }) => { row.excel[0].inventoryNumber = ""; row.excel[0].inventoryReferences = []; }],
  ["a fractional physical row", ({ row }) => { row.excel[0].rowNumber = 1.5; }],
  ["an empty name", ({ row }) => { row.excel[0].nomenclature = "   "; }],
  ["an overlong name", ({ row }) => { row.excel[0].nomenclature = "А".repeat(161); }],
  ["a control character in the name", ({ row }) => { row.excel[0].nomenclature = "Монитор\u0000"; }],
  ["multiple rows with equal names and codes", ({ row }) => { row.excel.push({ ...row.excel[0], rowNumber: 15 }); }],
];
for (const [label, mutate] of rejectedExcelFallback) {
  test(`Excel fallback rejects ${label} without changing either stored field`, () => {
    const value = fixture();
    value.row.oneC = [];
    value.item.oneCCode = "00009999";
    mutate(value);
    const before = JSON.stringify(value);
    const plan = buildInventoryAuditEnrichmentPlan([value.row], [value.item]);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
    assert.equal(plan.rows[0].nextName, value.item.name);
    assert.equal(plan.rows[0].nextCode, value.item.oneCCode);
    assert.equal(JSON.stringify(value), before);
  });
}

test("one physical Excel row reused as the chosen name cannot update either card", () => {
  const first = fixture(), second = fixture();
  second.item.id = second.row.itemId = "site-2";
  first.row.oneC = [];
  second.row.oneC = [];
  const plan = buildInventoryAuditEnrichmentPlan([first.row, second.row], [first.item, second.item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 2 });
  assert.ok(plan.rows.every((row) => row.reason === "source_reused"));
});

test("an existing Excel fallback name is unchanged and its lone code cannot be assigned", () => {
  const { item, row } = fixture();
  row.oneC = [];
  item.name = row.itemName = row.excel[0].nomenclature;
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
  assert.equal(plan.rows[0].nameSource, "excel");
  assert.equal(plan.rows[0].codeStatus, "sources_missing");
  assert.equal(plan.rows[0].nextCode, null);
});

test("duplicate saved audit rows cannot produce two proposals for one card", () => {
  const { item, row } = fixture();
  const plan = buildInventoryAuditEnrichmentPlan([row, structuredClone(row)], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 2 });
  assert.ok(plan.rows.every((entry) => entry.reason === "source_ambiguous"));
});

test("Excel fallback also rejects stale item snapshots before proposing a name", () => {
  for (const mutate of [
    ({ item }: ReturnType<typeof fixture>) => { item.version++; },
    ({ item }: ReturnType<typeof fixture>) => { item.name = "Новое имя"; },
    ({ item }: ReturnType<typeof fixture>) => { item.inventoryNumber = "2411/00389"; },
    ({ item }: ReturnType<typeof fixture>) => { item.officialBarcodes = []; },
  ]) {
    const value = fixture();
    value.row.oneC = [];
    mutate(value);
    const plan = buildInventoryAuditEnrichmentPlan([value.row], [value.item]);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
    assert.equal(plan.rows[0].reason, "item_changed");
    assert.equal(plan.rows[0].nextName, value.item.name);
    assert.equal(plan.rows[0].nextCode, value.item.oneCCode);
  }
});

test("a deleted item remains visible as skipped and never gains an update", () => {
  const { row } = fixture();
  const plan = buildInventoryAuditEnrichmentPlan([row], []);
  assert.equal(plan.rows[0].reason, "item_not_found");
  assert.equal(plan.counts.skipped, 1);
});

test("a code normalized with trim and NFKC agrees while retaining leading zeroes", () => {
  const { item, row } = fixture();
  row.oneC[0].code = " ００００３２５４ ";
  row.excel[0].oneCCode = "00003254";
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].nextCode, "00003254");
});
