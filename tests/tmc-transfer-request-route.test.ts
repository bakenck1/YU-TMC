import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import type { CreateTmcTransferRequestResultDto } from "../lib/contracts/tmc-operations";
import { ApplicationError } from "../lib/domain/application-error";
import { createTmcTransferRequestPostHandler } from "../lib/server/http/tmc-transfer-request-handler";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
};
const RECIPIENT_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_ID = "90000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "tmc-route-create-001";
const CREATED_RESULT = {
  request: { id: REQUEST_ID, recipient: { id: RECIPIENT_ID } },
  total: 1,
  included: 1,
  problems: 0,
  items: [{ itemId: ITEM_ID, outcome: "included" }],
} as unknown as CreateTmcTransferRequestResultDto;
const PROBLEM_RESULT: CreateTmcTransferRequestResultDto = {
  request: null,
  total: 1,
  included: 0,
  problems: 1,
  items: [{ itemId: ITEM_ID, outcome: "problem", problem: "item_unavailable" }],
};

test("TMC transfer request server boundary type-checks and wires only idempotent create", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "--project",
      path.join("tests", "typecheck", "tsconfig.tmc-transfer-request-route.json"),
      "--pretty",
      "false",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );

  const route = readFileSync(
    path.join("app", "api", "inventory", "transfer-requests", "route.ts"),
    "utf8",
  );
  assert.match(route, /tmcTransferRequests\.createIdempotent\(/);
  assert.doesNotMatch(route, /tmcTransferRequests\.create\(/);
  assert.doesNotMatch(route, /export .*createTmcTransferRequestPostHandler/);
});

test("POST transfer-requests forwards only authenticated server identity and exact command input", async () => {
  const calls: unknown[][] = [];
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async (...arguments_) => {
      calls.push(arguments_);
      return {
        kind: "completed",
        body: { result: CREATED_RESULT },
        resourceId: REQUEST_ID,
        status: 201,
      };
    },
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID, ITEM_ID],
    comment: "  Передача  ",
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { result: CREATED_RESULT });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("idempotency-replayed"), null);
  assert.deepEqual(calls, [[{
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID, ITEM_ID],
    comment: "  Передача  ",
  }, ACTOR, IDEMPOTENCY_KEY]]);
});

test("POST schedules one aggregate notification only for a freshly created request", async () => {
  const scheduled: unknown[] = [];
  let kind: "completed" | "replayed" = "completed";
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({ kind, body: { result: CREATED_RESULT }, resourceId: REQUEST_ID, status: 201 }),
    onCreated: (event) => scheduled.push(event),
  });
  await handler(jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }));
  kind = "replayed";
  await handler(jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }));
  assert.deepEqual(scheduled, [{ requestId: REQUEST_ID, recipientId: RECIPIENT_ID, itemCount: 1 }]);

  const noRequest = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({ kind: "completed", body: { result: PROBLEM_RESULT }, status: 200 }),
    onCreated: (event) => scheduled.push(event),
  });
  await noRequest(jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }));
  assert.equal(scheduled.length, 1);

  const schedulingErrors: unknown[] = [];
  const schedulingFailure = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({ kind: "completed", body: { result: CREATED_RESULT }, resourceId: REQUEST_ID, status: 201 }),
    onCreated: () => { throw new Error("after unavailable"); },
    onCreationNotificationSchedulingError: (event, error) => schedulingErrors.push({ event, error }),
  });
  const response = await schedulingFailure(jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }));
  assert.equal(response.status, 201);
  assert.deepEqual((schedulingErrors[0] as { event: { requestId: string } }).event, { requestId: REQUEST_ID, recipientId: RECIPIENT_ID, itemCount: 1 });

  const diagnosticFailure = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({ kind: "completed", body: { result: CREATED_RESULT }, resourceId: REQUEST_ID, status: 201 }),
    onCreated: () => { throw new Error("after unavailable"); },
    onCreationNotificationSchedulingError: () => { throw new Error("logger unavailable"); },
  });
  assert.equal((await diagnosticFailure(jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }))).status, 201);
});

test("POST transfer-requests preserves replay status and exact stored body", async () => {
  const body = { result: CREATED_RESULT };
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({
      kind: "replayed",
      body,
      resourceId: REQUEST_ID,
      status: 201,
    }),
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), body);
  assert.equal(response.headers.get("idempotency-replayed"), "true");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("POST transfer-requests returns the persisted 200 all-problem result", async () => {
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => ({
      kind: "completed",
      body: { result: PROBLEM_RESULT },
      status: 200,
    }),
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: PROBLEM_RESULT });
});

test("POST transfer-requests rejects malformed, ambiguous, and unsupported bodies", async (context) => {
  for (const [name, request, status, code] of [
    ["missing key", jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID] }, false), 400, "idempotency_key_required"],
    ["malformed JSON", rawRequest("{"), 400, "invalid_request"],
    ["array JSON", jsonRequest([]), 400, "invalid_request"],
    ["unknown identity field", jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [ITEM_ID], actorId: ACTOR.userId }), 400, "invalid_request"],
    ["non-string item", jsonRequest({ recipientId: RECIPIENT_ID, itemIds: [7] }), 400, "invalid_request"],
    ["wrong media type", rawRequest("{}", "text/plain"), 415, "unsupported_media_type"],
  ] as const) {
    await context.test(name, async () => {
      let commandCalls = 0;
      const handler = createTmcTransferRequestPostHandler({
        authenticate: async () => ACTOR,
        createIdempotent: async () => {
          commandCalls += 1;
          throw new Error("must_not_run");
        },
      });
      const response = await handler(request);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: code });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(commandCalls, 0);
    });
  }
});

test("POST transfer-requests applies body, key, then DTO validation priority", async (context) => {
  for (const [name, request, code, status] of [
    ["media type before missing key", rawRequest("{}", "text/plain", {}), "unsupported_media_type", 415],
    ["malformed body before missing key", rawRequest("{", "application/json", {}), "invalid_request", 400],
    ["key syntax before DTO", rawRequest(JSON.stringify({ actorId: ACTOR.userId }), "application/json", { "idempotency-key": "short" }), "idempotency_key_invalid", 400],
  ] as const) {
    await context.test(name, async () => {
      let commandCalls = 0;
      const handler = createTmcTransferRequestPostHandler({
        authenticate: async () => ACTOR,
        createIdempotent: async () => {
          commandCalls += 1;
          throw new Error("must_not_run");
        },
      });
      const response = await handler(request);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: code });
      assert.equal(commandCalls, 0);
    });
  }
});

test("POST transfer-requests rejects declared and streamed oversized JSON", async (context) => {
  const oversized = JSON.stringify({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
    comment: "x".repeat(17_000),
  });
  for (const [name, request] of [
    ["declared", rawRequest("{}", "application/json", {
      "content-length": "17001",
      "idempotency-key": IDEMPOTENCY_KEY,
    })],
    ["streamed", rawRequest(oversized)],
  ] as const) {
    await context.test(name, async () => {
      let commandCalls = 0;
      const handler = createTmcTransferRequestPostHandler({
        authenticate: async () => ACTOR,
        createIdempotent: async () => {
          commandCalls += 1;
          throw new Error("must_not_run");
        },
      });
      const response = await handler(request);
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: "payload_too_large" });
      assert.equal(commandCalls, 0);
    });
  }
});

test("POST transfer-requests preserves 413 when oversized stream cancellation fails", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(17_000));
    },
    cancel() {
      throw new Error("injected_cancel_failure");
    },
  });
  const request = new Request(
    "https://inventory.example/api/inventory/transfer-requests",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => {
      throw new Error("must_not_run");
    },
  });

  const response = await handler(request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
});

test("POST transfer-requests maps authentication failures before command execution", async () => {
  let commandCalls = 0;
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => {
      throw new ApplicationError("forbidden", "cross_site_request_blocked");
    },
    createIdempotent: async () => {
      commandCalls += 1;
      throw new Error("must_not_run");
    },
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "cross_site_request_blocked" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(commandCalls, 0);
});

test("POST transfer-requests maps idempotency conflicts with retry semantics", async (context) => {
  for (const [code, retryAfter] of [
    ["idempotency_key_reused", null],
    ["idempotency_request_in_progress", "1"],
  ] as const) {
    await context.test(code, async () => {
      const handler = createTmcTransferRequestPostHandler({
        authenticate: async () => ACTOR,
        createIdempotent: async () => {
          throw new ApplicationError("conflict", code);
        },
      });
      const response = await handler(jsonRequest({
        recipientId: RECIPIENT_ID,
        itemIds: [ITEM_ID],
      }));
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: code });
      assert.equal(response.headers.get("retry-after"), retryAfter);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  }
});

test("POST transfer-requests forwards safe rate-limit retry timing", async () => {
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => {
      throw new ApplicationError("rate_limited", "too_many_requests", {
        safeDetails: { retryAfterSeconds: "37" },
      });
    },
    createIdempotent: async () => {
      throw new Error("must_not_run");
    },
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
  }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
  assert.deepEqual(await response.json(), {
    error: "too_many_requests",
    details: { retryAfterSeconds: "37" },
  });
});

test("POST transfer-requests does not expose unexpected server errors", async () => {
  const handler = createTmcTransferRequestPostHandler({
    authenticate: async () => ACTOR,
    createIdempotent: async () => {
      throw new Error("database password leaked");
    },
  });

  const response = await handler(jsonRequest({
    recipientId: RECIPIENT_ID,
    itemIds: [ITEM_ID],
  }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

function jsonRequest(value: unknown, withKey = true) {
  return rawRequest(JSON.stringify(value), "application/json", withKey
    ? { "idempotency-key": IDEMPOTENCY_KEY }
    : {});
}

function rawRequest(
  body: string,
  contentType = "application/json",
  headers: Record<string, string> = { "idempotency-key": IDEMPOTENCY_KEY },
) {
  return new Request("https://inventory.example/api/inventory/transfer-requests", {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body,
  });
}
