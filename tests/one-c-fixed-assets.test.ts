import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { Pool } from "pg";

import { createOneCFixedAssetsPostHandler, getOneCFixedAssetsCapability } from "@/lib/server/http/one-c-fixed-assets-handler";
import type { OneCFixedAssetImportService } from "@/lib/application/services/one-c-fixed-asset-import-service";
import { OneCImportUnavailableError } from "@/lib/application/ports/one-c-fixed-assets-repository";
import { MAX_ONE_C_RECORDS, MAX_ONE_C_TEXT_LENGTH, parseOneCFixedAssets } from "@/lib/server/integrations/one-c-fixed-assets";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { observeHttpRequest } from "@/lib/server/observability";

const API_KEY = "test-one-c-key";
const GUID = "eba5b834-db3b-11f0-a26e-7cc25579bdd7";
const XML = `<FixedAssets><FixedAsset><GUID>${GUID}</GUID><Code>000009352</Code><Name>Компьютер</Name></FixedAsset></FixedAssets>`;

describe("1C fixed assets HTTP boundary", () => {
  it("reports capability and configuration without claiming database readiness", async () => {
    const response = getOneCFixedAssetsCapability("");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      service: "1c-fixed-assets", status: "capability", configured: false,
      method: "POST", authentication: "Bearer token required",
      contentType: ["application/xml", "text/xml"], maximumBytes: 10 * 1024 * 1024,
    });
  });

  it("rejects missing configuration, wrong credentials, and media type before persistence", async () => {
    let calls = 0;
    const service = serviceThat(async () => { calls += 1; return { received: 1, ...emptyResult() }; });
    const missing = await createOneCFixedAssetsPostHandler({ service, apiKey: () => "" })(request(XML));
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { error: "integration_not_configured" });
    const wrong = await createOneCFixedAssetsPostHandler({ service, apiKey: () => API_KEY })(request(XML, { authorization: "Bearer wrong" }));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("www-authenticate"), "Bearer");
    const media = await createOneCFixedAssetsPostHandler({ service, apiKey: () => API_KEY })(request(XML, { "content-type": "application/json" }));
    assert.equal(media.status, 415);
    assert.equal(calls, 0);
  });

  it("rejects declared and actually streamed bodies beyond 10 MiB", async () => {
    const handler = createOneCFixedAssetsPostHandler({ service: serviceThat(async () => { throw new Error("must_not_store"); }), apiKey: () => API_KEY });
    const declared = request("x", { "content-length": String(10 * 1024 * 1024 + 1) });
    const declaredResponse = await handler(declared);
    assert.equal(declaredResponse.status, 413);
    assert.equal((await declaredResponse.json()).error, "xml_too_large");

    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); controller.close(); } });
    const streamed = new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
      method: "POST", headers: headers(), body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const streamedResponse = await handler(streamed);
    assert.equal(streamedResponse.status, 413);
    assert.equal((await streamedResponse.json()).error, "xml_too_large");
  });

  it("rejects malformed UTF-8, malformed XML, and empty batches safely", async () => {
    const handler = createOneCFixedAssetsPostHandler({ service: serviceThat(async () => ({ received: 0, ...emptyResult() })), apiKey: () => API_KEY });
    const invalidBytes = new Uint8Array([0xc3, 0x28]);
    for (const [body, code] of [[invalidBytes, "invalid_utf8"], ["<FixedAssets>", "invalid_xml"], ["<FixedAssets/>", "fixed_assets_not_found"]] as const) {
      const response = await handler(request(body));
      assert.equal(response.status, 400);
      const json = await response.json();
      assert.equal(json.error, code);
      assert.match(json.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("returns trustworthy counters and never exposes a database exception", async () => {
    const success = await createOneCFixedAssetsPostHandler({
      service: serviceThat(async () => ({ received: 1, created: 1, updated: 0, unchanged: 0 })), apiKey: () => API_KEY,
    })(request(XML));
    assert.equal(success.status, 200);
    assert.deepEqual(pickResult(await success.json()), { success: true, received: 1, created: 1, updated: 0, unchanged: 0 });

    const internal = new Error('duplicate key violates constraint "secret_table_pkey"');
    const logged: Array<{ requestId: string; errorCode: string; errorName: string }> = [];
    const failure = await createOneCFixedAssetsPostHandler({
      service: serviceThat(async () => { throw internal; }), apiKey: () => API_KEY, logFailure: (event) => logged.push(event),
    })(request(XML));
    assert.equal(failure.status, 500);
    const body = await failure.json();
    assert.equal(body.error, "store_failed");
    assert.ok(!JSON.stringify(body).includes("secret_table"));
    assert.equal(logged[0]?.requestId, body.requestId);
    assert.deepEqual(logged[0] && { errorCode: logged[0].errorCode, errorName: logged[0].errorName }, { errorCode: "internal_error", errorName: "Error" });
    assert.ok(!JSON.stringify(logged).includes("secret_table"));

    const unavailable = await createOneCFixedAssetsPostHandler({
      service: serviceThat(async () => { throw new OneCImportUnavailableError("store_unavailable", { cause: internal }); }),
      apiKey: () => API_KEY, logFailure: (event) => logged.push(event),
    })(request(XML));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error, "store_unavailable");
  });

  it("reuses the observer request ID in successful response bodies", async () => {
    const handler = createOneCFixedAssetsPostHandler({
      service: serviceThat(async () => ({ received: 1, created: 1, updated: 0, unchanged: 0 })),
      apiKey: () => API_KEY,
    });
    const response = await observeHttpRequest(
      request(XML),
      "/api/integrations/1c/fixed-assets",
      () => handler(request(XML)),
      { sink: () => undefined },
    );
    const body = await response.json() as { requestId: string };
    assert.equal(body.requestId, response.headers.get("x-request-id"));
  });

  it("allows only one in-flight import for the configured key", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const handler = createOneCFixedAssetsPostHandler({ service: serviceThat(async () => { await pending; return { received: 1, created: 1, updated: 0, unchanged: 0 }; }), apiKey: () => API_KEY });
    const first = handler(request(XML));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await handler(request(XML));
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "5");
    release();
    assert.equal((await first).status, 200);
  });

  it("bounds slow request streams and releases the import lease", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel: () => { cancelled = true; },
    });
    const service = serviceThat(async () => { throw new Error("must_not_store"); });
    const handler = createOneCFixedAssetsPostHandler({ service, apiKey: () => API_KEY, bodyTimeoutMs: 10, logFailure: () => undefined });
    const slow = new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
      method: "POST", headers: headers(), body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await handler(slow);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "import_timeout");
    assert.equal(cancelled, true);
    assert.equal((await handler(request(XML))).status, 500);
  });
});

describe("1C fixed assets XML contract", () => {
  it("parses canonical and documented aliases into normalized values", () => {
    const assets = parseOneCFixedAssets(`<?xml version="1.0" encoding="UTF-8"?><FixedAssetsExport><FixedAsset>
      <ExternalId>${GUID}</ExternalId><Code>000009352</Code><InventoryNumber>000009352</InventoryNumber>
      <Name>Тестовое основное средство</Name><Status>Принят к учету</Status><ResidualCost>12544,50</ResidualCost><AcceptedAt>20.11.2025</AcceptedAt>
    </FixedAsset></FixedAssetsExport>`);
    assert.deepEqual(assets[0] && { externalId: assets[0].externalId, status: assets[0].status, residualCost: assets[0].residualCost, acceptedAt: assets[0].acceptedAt }, {
      externalId: GUID, status: "Принято к учёту", residualCost: 12544.5, acceptedAt: "2025-11-20",
    });
  });

  it("canonicalizes UUID identifiers before idempotency hashing and storage", () => {
    const upper = GUID.toUpperCase();
    const assets = parseOneCFixedAssets(`<FixedAssets><FixedAsset><GUID>${upper}</GUID><ResponsibleGUID>${upper}</ResponsibleGUID><Name>x</Name></FixedAsset></FixedAssets>`);
    assert.equal(assets[0]?.externalId, GUID);
    assert.equal(assets[0]?.responsibleExternalId, GUID);
  });

  it("enforces exact shape, duplicate, length, record-count, entity and namespace policy", () => {
    const cases = [
      ["<Envelope><FixedAssets><FixedAsset><GUID>" + GUID + "</GUID><Name>x</Name></FixedAsset></FixedAssets></Envelope>", "invalid_root"],
      [`<FixedAssets><FixedAsset><GUID>${GUID}</GUID><Name>x</Name></FixedAsset><FixedAsset><GUID>${GUID}</GUID><Name>y</Name></FixedAsset></FixedAssets>`, "duplicate_external_id"],
      [`<FixedAssets><FixedAsset><GUID>${GUID}</GUID><Name>${"x".repeat(MAX_ONE_C_TEXT_LENGTH + 1)}</Name></FixedAsset></FixedAssets>`, "text_too_long"],
      [`<!DOCTYPE FixedAssets [<!ENTITY x "y">]><FixedAssets><FixedAsset><GUID>${GUID}</GUID><Name>&x;</Name></FixedAsset></FixedAssets>`, "xml_entities_not_supported"],
      [`<x:FixedAssets xmlns:x="urn:test"><x:FixedAsset/></x:FixedAssets>`, "xml_namespaces_not_supported"],
      [`<FixedAssets>${Array.from({ length: MAX_ONE_C_RECORDS + 1 }, (_, index) => `<FixedAsset><GUID>00000000-0000-4000-8000-${String(index).padStart(12, "0")}</GUID><Name>x</Name></FixedAsset>`).join("")}</FixedAssets>`, "too_many_records"],
    ] as const;
    for (const [xml, code] of cases) assert.throws(() => parseOneCFixedAssets(xml), new RegExp(code));
  });

  it("rejects invalid identifiers, statuses, numbers, and real calendar dates", () => {
    for (const field of ["<GUID>bad</GUID>", `<GUID>${GUID}</GUID><Status>Удалено</Status>`, `<GUID>${GUID}</GUID><Quantity>-1</Quantity>`, `<GUID>${GUID}</GUID><AcceptedAt>2026-02-30</AcceptedAt>`, `<GUID>${GUID}</GUID><UpdatedAt>2026-02-30T10:00:00Z</UpdatedAt>`]) {
      assert.throws(() => parseOneCFixedAssets(`<FixedAssets><FixedAsset>${field}<Name>x</Name></FixedAsset></FixedAssets>`));
    }
  });

  it("keeps the inbox constraint in a forward-only migration", () => {
    const original = readFileSync("drizzle/20260903120000_one_c_fixed_asset_inbox.sql", "utf8");
    const forward = readFileSync("drizzle/20260908113000_one_c_fixed_asset_inbox_contract.sql", "utf8");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ tag: string }> };
    assert.doesNotMatch(original, /payload_hash_check/);
    assert.match(forward, /ADD CONSTRAINT "one_c_fixed_asset_inbox_payload_hash_check"/);
    const contractIndex = journal.entries.findIndex((entry) => entry.tag === "20260908113000_one_c_fixed_asset_inbox_contract");
    assert.equal(journal.entries[contractIndex - 1]?.tag, "20260907123710_elite_vulcan");
  });

  it("discards PostgreSQL clients when advisory unlock or rollback cleanup fails", async () => {
    const unlockReleases: unknown[] = [];
    const unlockClient = {
      query: async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
        throw new Error("unlock_failed");
      },
      release: (error?: unknown) => { unlockReleases.push(error); },
    };
    const unlockRepository = new PostgresOneCFixedAssetRepository(
      { connect: async () => unlockClient } as unknown as Pick<Pool, "connect">,
    );
    const lease = await unlockRepository.tryAcquireLease("key");
    await assert.rejects(lease?.release(), OneCImportUnavailableError);
    assert.equal(unlockReleases[0] instanceof Error, true);

    const rollbackReleases: unknown[] = [];
    const rollbackClient = {
      query: async (sql: string) => {
        if (sql === "begin" || sql.includes("set_config")) return { rows: [], rowCount: 0 };
        if (sql === "rollback") throw new Error("rollback_failed");
        throw new Error("insert_failed");
      },
      release: (destroy?: unknown) => { rollbackReleases.push(destroy); },
    };
    const rollbackRepository = new PostgresOneCFixedAssetRepository(
      { connect: async () => rollbackClient } as unknown as Pick<Pool, "connect">,
    );
    await assert.rejects(rollbackRepository.saveBatch(parseOneCFixedAssets(XML)), OneCImportUnavailableError);
    assert.deepEqual(rollbackReleases, [true]);
  });
});

function headers(overrides: Record<string, string> = {}) { return { authorization: `Bearer ${API_KEY}`, "content-type": "application/xml", ...overrides }; }
function request(body: BodyInit, overrides: Record<string, string> = {}) { return new Request("https://inventory.example/api/integrations/1c/fixed-assets", { method: "POST", headers: headers(overrides), body }); }
function serviceThat(importBatch: OneCFixedAssetImportService["importBatch"]): Pick<OneCFixedAssetImportService, "importBatch" | "tryAcquireLease"> {
  let leased = false;
  return {
    importBatch,
    tryAcquireLease: async () => {
      if (leased) return null;
      leased = true;
      return { release: async () => { leased = false; } };
    },
  };
}
function emptyResult() { return { created: 0, updated: 0, unchanged: 0 }; }
function pickResult(value: Record<string, unknown>) { const { success, received, created, updated, unchanged } = value; return { success, received, created, updated, unchanged }; }
