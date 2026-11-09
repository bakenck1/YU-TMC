import assert from "node:assert/strict";
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

test("search history deduplicates Unicode and repeated whitespace without losing code zeros", () => {
  assert.deepEqual(
    parseSearchHistory(JSON.stringify(["  МОНОБЛОК  Lenovo ", "моноблок\u00a0Lenovo", "００１２３", "00123", "123"])),
    ["МОНОБЛОК  Lenovo", "００１２３", "123"],
  );
  assert.deepEqual(
    addSearchHistoryEntry(["Моноблок  Lenovo", "MONOBLOCK", "00123"], " моноблок Lenovo "),
    ["моноблок Lenovo", "MONOBLOCK", "00123"],
  );
});
