import assert from "node:assert/strict";
import test from "node:test";
import { oneCInventoryPresence, oneCMissingInventoryMessage } from "@/lib/one-c-inventory-presence";

const missing = {
  review_state: "blocked", match_method: "new_candidate", matched_item_id: null,
  published_item_id: null, payload: { name: "Шкаф", inventoryNumber: "0001/02", status: "Принято к учёту" },
  issues: [{ code: "missing_room" }, { code: "unsupported_item_type" }],
};

test("an absent cabinet remains missing even when its publication needs a room or item type", () => {
  assert.equal(oneCInventoryPresence(missing), "missing");
  assert.equal(oneCMissingInventoryMessage("Шкаф книжный"), "Осы шкаф жоқ — нет в Inventory");
  assert.equal(oneCMissingInventoryMessage("Стол"), "Осы ТМЦ жоқ — нет в Inventory");
});

test("possible matches, conflicts, missing identifiers and invalid barcodes need review", () => {
  for (const row of [
    { ...missing, match_method: "possible_match" },
    { ...missing, review_state: "conflict" },
    { ...missing, match_method: "ambiguous_conflict" },
    { ...missing, payload: { status: "Принято к учёту", inventoryNumber: " \t ", code: null } },
    { ...missing, issues: [{ code: "invalid_one_c_barcode" }] },
    { ...missing, payload: { ...missing.payload, status: "Снято с учёта" } },
    { ...missing, payload: { ...missing.payload, status: "Не в учёте" } },
  ]) assert.equal(oneCInventoryPresence(row), "review");
});

test("unanalyzed, excluded, linked and published records are never reported missing", () => {
  assert.equal(oneCInventoryPresence({ ...missing, review_state: "pending" }), "pending");
  assert.equal(oneCInventoryPresence({ ...missing, match_method: null }), "pending");
  assert.equal(oneCInventoryPresence({ ...missing, review_state: "excluded" }), "excluded");
  assert.equal(oneCInventoryPresence({ ...missing, issues: [{ code: "non_physical_asset" }] }), "excluded");
  assert.equal(oneCInventoryPresence({ ...missing, matched_item_id: "item-1" }), "found");
  assert.equal(oneCInventoryPresence({ ...missing, published_item_id: "item-1", review_state: "published" }), "found");
});
