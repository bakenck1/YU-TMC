import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as rows } from "@/app/api/integrations/1c/batches/[id]/rows/route";
import { POST as analyze } from "@/app/api/integrations/1c/batches/[id]/analyze/route";
import { POST as approve } from "@/app/api/integrations/1c/batches/[id]/approve/route";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

function context(id: string) { return { params: Promise.resolve({ id }) }; }
function path(id: string, action: string) { return `/api/integrations/1c/batches/${id}/${action}`; }
function asset(overrides: Partial<OneCFixedAsset> = {}): OneCFixedAsset {
  return {
    externalId: randomUUID(), code: "CODE-ALPHA", name: "Projector-BETA",
    inventoryNumber: "INV-GAMMA", barcode: "BAR-DELTA", category: null,
    location: "Building-EPSILON", responsibleName: "Owner-ZETA", responsibleExternalId: null,
    quantity: 1, residualCost: 100, status: "Принято к учёту", acceptedAt: null, updatedAt: null,
    ...overrides,
  };
}
async function seedBatch(assets: OneCFixedAsset[], verified = true) {
  const sourceSha256 = createHash("sha256").update(randomUUID()).digest("hex");
  await new PostgresOneCFixedAssetRepository(database).saveBatch(assets, {
    sourceSha256, requestId: randomUUID(), sourceFilename: "endpoint-test.xml",
  });
  const id = (await database.query("select id from yu_inventory.one_c_import_batches where source_sha256=$1", [sourceSha256])).rows[0].id as string;
  // Historical snapshots can predate the source-provenance fields.
  if (!verified) await database.query("update yu_inventory.one_c_import_batches set request_id=null,source_filename=null where id=$1", [id]);
  return id;
}

describe("1C reconciliation endpoints with PostgreSQL", () => {
  let admin: { userId: string; role: "admin" };
  beforeAll(async () => {
    resetApplicationServicesForTests();
    await setupTmcTransferDatabase();
    const fixture = await seedFixture(0);
    await database.query("update yu_inventory.users set role='admin' where id=$1", [fixture.initiatorId]);
    admin = { userId: fixture.initiatorId, role: "admin" };
  });
  afterAll(async () => {
    resetApplicationServicesForTests();
    await teardownTmcTransferDatabase();
  });

  it("finds batch rows by each supported identifier, location and responsible person", async () => {
    const wanted = asset();
    const other = asset({ code: "UNRELATED", name: "Different", inventoryNumber: null, barcode: null, location: null, responsibleName: null });
    const batchId = await seedBatch([wanted, other]);
    for (const search of [wanted.externalId, "alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      const response = await rows(authenticatedRequest(`${path(batchId, "rows")}?search=${encodeURIComponent(search)}`, admin), context(batchId));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.rows.data.map((row: { external_id: string }) => row.external_id)).toEqual([wanted.externalId]);
    }
    const absent = await rows(authenticatedRequest(`${path(batchId, "rows")}?search=not-present`, admin), context(batchId));
    expect(absent.status).toBe(200);
    expect((await absent.json()).rows.data).toEqual([]);
  });

  it.each([
    { verified: false, blocked: true, expected: 409 },
    { verified: false, blocked: false, expected: 409 },
    { verified: true, blocked: true, expected: 409 },
    { verified: true, blocked: false, expected: 200 },
  ])("keeps approval guards after analysis: verified=$verified blocked=$blocked", async ({ verified, blocked, expected }) => {
    // Non-physical assets are excluded by analysis, leaving no unresolved rows.
    // Only provenance and the publication block should prevent approval.
    const batchId = await seedBatch([asset({ name: "Лицензия Microsoft Office" })], verified);
    await database.query("update yu_inventory.one_c_import_batches set summary=summary || $2::jsonb where id=$1", [batchId, JSON.stringify({ massPublicationBlocked: blocked })]);
    const initial = (await database.query("select version from yu_inventory.one_c_import_batches where id=$1", [batchId])).rows[0];
    const analysis = await analyze(authenticatedRequest(path(batchId, "analyze"), admin, { body: { version: initial.version } }), context(batchId));
    expect(analysis.status, await analysis.clone().text()).toBe(200);
    const saved = (await database.query("select version,summary from yu_inventory.one_c_import_batches where id=$1", [batchId])).rows[0];
    expect(saved.summary.massPublicationBlocked).toBe(blocked);
    const response = await approve(authenticatedRequest(path(batchId, "approve"), admin, {
      body: { version: saved.version, planHash: saved.summary.plan.hash },
    }), context(batchId));
    expect(response.status, await response.clone().text()).toBe(expected);
    const state = (await database.query("select state,approved_by from yu_inventory.one_c_import_batches where id=$1", [batchId])).rows[0];
    expect(state).toEqual({ state: expected === 200 ? "approved" : "review_required", approved_by: expected === 200 ? admin.userId : null });
  });
});
