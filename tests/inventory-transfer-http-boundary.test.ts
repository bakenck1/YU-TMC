import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TransferDto } from "../lib/contracts/inventory-responsibility";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryTransferCancelPostHandler } from "../lib/server/http/inventory-transfer-cancel-handler";
import { createInventoryTransferDecisionPostHandler } from "../lib/server/http/inventory-transfer-decision-handler";
import { createInventoryTransferOverridePostHandler } from "../lib/server/http/inventory-transfer-override-handler";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "admin" as const,
  sessionVersion: 3,
};

type Handler = (request: Request, transferId: string) => Promise<Response>;
type FailureState = {
  authentication?: unknown;
  useCase?: unknown;
  useCaseCalls: number;
};

const ROUTES: ReadonlyArray<{
  name: string;
  body: unknown;
  create(state: FailureState): Handler;
}> = [
  {
    name: "cancel",
    body: { version: 1 },
    create: (state) => createInventoryTransferCancelPostHandler({
      authenticate: async () => authenticate(state),
      cancelTransfer: async (id) => execute(state, id),
    }),
  },
  {
    name: "decision",
    body: { version: 1, decision: "confirm" },
    create: (state) => createInventoryTransferDecisionPostHandler({
      authenticate: async () => authenticate(state),
      decideTransfer: async (id) => execute(state, id),
    }),
  },
  {
    name: "override",
    body: { version: 1, reason: "Correction", outcome: "released" },
    create: (state) => createInventoryTransferOverridePostHandler({
      authenticate: async () => authenticate(state),
      overrideTransfer: async (id) => execute(state, id),
    }),
  },
];

const ERROR_CASES: ReadonlyArray<{
  name: string;
  authentication?: unknown;
  useCase?: unknown;
  transferId?: string;
  status: number;
  error: string;
  details?: Readonly<Record<string, string>>;
  retryAfter?: string | null;
}> = [
  {
    name: "malformed ID",
    transferId: "not-a-uuid",
    status: 404,
    error: "transfer_not_found",
  },
  {
    name: "unauthenticated",
    authentication: new ApplicationError("unauthorized", "unauthorized"),
    transferId: "not-a-uuid",
    status: 401,
    error: "unauthorized",
  },
  {
    name: "forbidden",
    authentication: new ApplicationError("forbidden", "cross_site_request_blocked"),
    transferId: "not-a-uuid",
    status: 403,
    error: "cross_site_request_blocked",
  },
  {
    name: "not found",
    useCase: new ApplicationError("not_found", "transfer_not_found"),
    status: 404,
    error: "transfer_not_found",
  },
  {
    name: "domain conflict",
    useCase: new ApplicationError("conflict", "transfer_version_conflict"),
    status: 409,
    error: "transfer_version_conflict",
  },
  {
    name: "rate limited with safe retry timing",
    authentication: new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "7" },
    }),
    status: 429,
    error: "too_many_requests",
    details: { retryAfterSeconds: "7" },
    retryAfter: "7",
  },
  {
    name: "rate limited with unsafe retry timing",
    authentication: new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "\r\nunsafe" },
    }),
    status: 429,
    error: "too_many_requests",
    details: { retryAfterSeconds: "\r\nunsafe" },
    retryAfter: null,
  },
  {
    name: "unexpected error",
    useCase: new Error("database password must stay private"),
    status: 503,
    error: "transfer_unavailable",
  },
];

for (const route of ROUTES) {
  test(`${route.name} uses the shared legacy transfer HTTP contract`, async () => {
    const successState: FailureState = { useCaseCalls: 0 };
    const success = await route.create(successState)(
      jsonRequest(route.body),
      TRANSFER_ID.toUpperCase(),
    );
    assert.equal(success.status, 200);
    assert.equal(success.headers.get("cache-control"), "no-store");
    assert.deepEqual(await success.json(), { transfer: { id: TRANSFER_ID } });
    assert.equal(successState.useCaseCalls, 1);

    for (const scenario of ERROR_CASES) {
      const state: FailureState = {
        authentication: scenario.authentication,
        useCase: scenario.useCase,
        useCaseCalls: 0,
      };
      const response = await route.create(state)(
        jsonRequest(route.body),
        scenario.transferId ?? TRANSFER_ID,
      );
      const serializedBody = await response.text();

      assert.equal(response.status, scenario.status, scenario.name);
      assert.equal(response.headers.get("cache-control"), "no-store", scenario.name);
      assert.equal(
        response.headers.get("retry-after"),
        scenario.retryAfter ?? null,
        scenario.name,
      );
      assert.deepEqual(
        JSON.parse(serializedBody),
        {
          error: scenario.error,
          ...(scenario.details ? { details: scenario.details } : {}),
        },
        scenario.name,
      );
      assert.doesNotMatch(serializedBody, /database password/, scenario.name);
      assert.equal(
        state.useCaseCalls,
        scenario.useCase === undefined ? 0 : 1,
        scenario.name,
      );
    }
  });
}

test("legacy transfer handlers cannot reintroduce local ID, error or cache primitives", async () => {
  const handlerFiles = [
    "lib/server/http/inventory-transfer-cancel-handler.ts",
    "lib/server/http/inventory-transfer-decision-handler.ts",
    "lib/server/http/inventory-transfer-override-handler.ts",
  ];

  for (const filename of handlerFiles) {
    const source = await readFile(filename, "utf8");
    assert.match(source, /from "@\/lib\/server\/http\/inventory-transfer-route-boundary"/);
    assert.match(source, /parseLegacyTransferId\(transferId\)/);
    assert.match(source, /legacyTransferJsonResponse\(\{ transfer \}\)/);
    assert.match(source, /legacyTransferErrorResponse\(error\)/);
    assert.doesNotMatch(source, /function (?:normalizeTransferId|errorResponse|errorHeaders)\b/);
    assert.doesNotMatch(source, /\b(?:isUuid|applicationErrorResponse|Response\.json)\b/);
    assert.doesNotMatch(source, /["']cache-control["']\s*:/);
  }
});

function authenticate(state: FailureState) {
  if (state.authentication !== undefined) throw state.authentication;
  return ACTOR;
}

function execute(state: FailureState, id: string): TransferDto {
  state.useCaseCalls += 1;
  if (state.useCase !== undefined) throw state.useCase;
  return { id } as TransferDto;
}

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
