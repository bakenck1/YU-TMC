import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SEARCH_HISTORY_LIMIT,
  addSearchHistoryEntry,
  parseSearchHistory,
} from "../lib/search-history";

test("search history keeps the newest unique trimmed queries", () => {
  const history = addSearchHistoryEntry(["Printer", "Scanner"], " printer ");
  assert.deepEqual(history, ["printer", "Scanner"]);
  const twenty = Array.from({ length: SEARCH_HISTORY_LIMIT }, (_, index) => `query ${index}`)
    .reduce((value, query) => addSearchHistoryEntry(value, query), [] as string[]);
  assert.equal(twenty.length, 20);
  const twentyOne = addSearchHistoryEntry(twenty, "query 20");
  assert.equal(twentyOne.length, 20);
  assert.equal(twentyOne[0], "query 20");
  assert.equal(twentyOne.at(-1), "query 1");
});

test("search history ignores malformed local storage and invalid entries", () => {
  assert.deepEqual(parseSearchHistory("not-json"), []);
  assert.deepEqual(
    parseSearchHistory(JSON.stringify(["  printer ", 42, "Printer", "scanner"])),
    ["printer", "scanner"],
  );
});

test("search history preserves the newest-to-oldest stored order", () => {
  assert.deepEqual(
    parseSearchHistory(JSON.stringify(["Newest", "Middle", "Oldest"])),
    ["Newest", "Middle", "Oldest"],
  );
});

test("search history menu retains keyboard focus and supports Escape", async () => {
  const source = await Promise.all([
    "../components/ItemsTable.tsx",
    "../components/InventoryFilterInput.tsx",
  ].map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8"))).then((sources) => sources.join("\n"));
  assert.match(source, /currentTarget\.contains\(event\.relatedTarget\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /visibleSearchHistory/);
  assert.match(source, /entry\.toLocaleLowerCase\(\)\.includes\(normalizedQuery\)/);
  assert.match(source, /function InventoryFilterInput/);
  assert.match(source, /item-filter-history:v1/);
  assert.match(source, /historyStorageKey=\{filterHistoryStorageKey/);
  assert.match(source, /onClick=\{\(\) => setSearchFocused\(true\)\}/);
  assert.doesNotMatch(source, /role="combobox"/);
});
