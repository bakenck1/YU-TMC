import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  TMC_OPERATION_PROBLEM_CODES,
} from "../lib/contracts/tmc-operations";
import {
  TMC_TRANSFER_ITEM_RESULTS,
  TMC_TRANSFER_REQUEST_STATUSES,
} from "../lib/contracts/inventory-domain";
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

test("TMC request contracts enforce state and command invariants", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "--project",
      path.join("tests", "typecheck", "tsconfig.tmc-operation-contracts.json"),
      "--pretty",
      "false",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});

test("TMC mutation commands live in a client-safe module behind the old barrel", async () => {
  const [barrel, commands] = await Promise.all([
    readFile("lib/contracts/tmc-operations.ts", "utf8"),
    readFile("lib/contracts/tmc-operation-commands.ts", "utf8"),
  ]);

  assert.match(barrel, /export type \{[\s\S]*?CreateTmcTransferRequestInput[\s\S]*?from "@\/lib\/contracts\/tmc-operation-commands"/);
  assert.doesNotMatch(barrel, /export interface (?:Create|Decide|Cancel)TmcTransferRequestInput/);
  assert.match(commands, /export interface CreateTmcTransferRequestInput/);
  assert.match(commands, /export interface DecideTmcTransferRequestInput/);
  assert.match(commands, /export interface CancelTmcTransferRequestInput/);
  assert.doesNotMatch(commands, /^\s*import\b/m);
  assert.doesNotMatch(commands, /(?:server-only|from "zod"|@\/lib\/db)/);
});
