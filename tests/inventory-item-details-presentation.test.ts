import assert from "node:assert/strict";
import test from "node:test";

import {
localizeItemError,
operationDetail,
responseErrorCode
} from "../components/InventoryItemDetailsPresentation";
import type { InventoryItemOperationDto } from "../lib/contracts/inventory-items";

const translate = (key: string) => key;

function operation(
  overrides: Partial<InventoryItemOperationDto> = {},
): InventoryItemOperationDto {
  return {
    id: "operation-1",
    kind: "transfer",
    action: "transfer.confirmed",
    actorName: "Alice",
    actorEmail: null,
    occurredAt: "2026-08-01T00:00:00.000Z",
    detail: null,
    ...overrides,
  };
}

test("operation presentation keeps audit labels and rich movement details", () => {
  const values = { targetName: "Alice", itemName: "Projector", componentName: "HDMI cable", componentInventoryNumber: "INV-CABLE", fromLocation: "101", toLocation: "102", source: "transfer", status: "active", outcome: "released", comment: "Moved after confirmation", reason: "Room reassignment" };
  const detail = operationDetail(operation({ detail: values }), translate);
  for (const value of [values.targetName, values.itemName, values.componentName, values.componentInventoryNumber, values.fromLocation, values.toLocation, values.comment, values.reason]) assert.ok(detail.includes(value), value);
});

test("item error presentation maps API codes without exposing unknown details", () => {
  assert.equal(
    localizeItemError(new Error("version_conflict"), translate),
    "itemDetails.errorConflict",
  );
  assert.equal(
    localizeItemError(new Error("invalid_item_price"), translate),
    "itemDetails.errorInvalidFields",
  );
  assert.equal(
    localizeItemError(new TypeError("network"), translate),
    "itemDetails.errorUnavailable",
  );
  assert.equal(localizeItemError(new Error("secret-db-message"), translate), "itemDetails.error");
});

test("response status mapping remains stable for mutation callers", () => {
  assert.deepEqual(
    [400, 401, 403, 404, 409, 422, 500].map(responseErrorCode),
    [
      "invalid_request",
      "unauthorized",
      "forbidden",
      "item_not_found",
      "version_conflict",
      "save_failed",
      "items_unavailable",
    ],
  );
});
