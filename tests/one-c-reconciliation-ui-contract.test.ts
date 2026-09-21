import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("1C reconciliation search covers identifiers, location and responsible person", () => {
  const source = readFileSync("lib/server/one-c-reconciliation-service.ts", "utf8");
  for (const field of ["code", "name", "inventoryNumber", "barcode", "location", "responsibleName"]) {
    assert.match(source, new RegExp(`payload->>'${field}' ilike`));
  }
});

test("legacy snapshots remain impossible to approve after analysis", () => {
  const source = readFileSync("lib/server/one-c-reconciliation-service.ts", "utf8");
  assert.match(source, /massPublicationBlocked/);
  assert.match(source, /request_id is null and source_filename is null/);
  assert.match(source, /\.\.\.existingSummary, \.\.\.summary, plan/);
});
