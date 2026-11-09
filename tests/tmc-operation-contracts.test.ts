import assert from "node:assert/strict";
import test from "node:test";

import {
TMC_TRANSFER_ITEM_RESULTS,
TMC_TRANSFER_REQUEST_STATUSES,
} from "../lib/contracts/inventory-domain";
import {
TMC_OPERATION_PROBLEM_CODES,
} from "../lib/contracts/tmc-operations";
import {
tmcTransferItemResultEnum,
tmcTransferRequestStatusEnum,
} from "../lib/db/schema";

test("TMC request domain enums stay aligned with PostgreSQL", () => {
  assert.deepEqual(TMC_OPERATION_PROBLEM_CODES, [
    "item_not_found",
    "item_unavailable",
    "item_inactive",
    "item_unassigned",
    "forbidden",
    "already_responsible",
    "active_transfer_exists",
    "responsibility_changed",
    "version_conflict",
    "duplicate_item",
    "room_not_found",
    "room_inactive",
  ]);
  assert.deepEqual(TMC_TRANSFER_REQUEST_STATUSES, [
    "pending",
    "accepted",
    "rejected",
    "cancelled",
  ]);
  assert.deepEqual(TMC_TRANSFER_ITEM_RESULTS, [
    "pending",
    "accepted",
    "rejected",
    "cancelled",
    "invalidated",
  ]);
  assert.deepEqual(
    tmcTransferRequestStatusEnum.enumValues,
    TMC_TRANSFER_REQUEST_STATUSES,
  );
  assert.deepEqual(
    tmcTransferItemResultEnum.enumValues,
    TMC_TRANSFER_ITEM_RESULTS,
  );
});
