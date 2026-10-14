import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { OneCMaterialsImportMetadata, OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";
import { OneCMaterialImportService } from "@/lib/application/services/one-c-material-import-service";
import { createOneCMaterialsPostHandler, getOneCMaterialsCapability } from "@/lib/server/http/one-c-materials-handler";
import { createOneCFixedAssetsPostHandler } from "@/lib/server/http/one-c-fixed-assets-handler";
import { observeHttpRequest } from "@/lib/server/observability";

const key = "test-materials-route-credential";
const xml = `<Materials><SchemaVersion>2</SchemaVersion><SnapshotAt>2026-10-14T12:00:00+05:00</SnapshotAt><Material><Code>00006135</Code><Name>МФУ</Name><AccountCode>1317</AccountCode><WarehouseCode>WH-01</WarehouseCode><Quantity>1</Quantity><UnitPrice>66784,48</UnitPrice><Responsible>Иванов Иван Иванович</Responsible><ResponsibleCode>001</ResponsibleCode><ResponsibleGUID>eba5b834-db3b-11f0-a26e-7cc25579bdd7</ResponsibleGUID></Material></Materials>`;

test("materials POST forwards its parsed snapshot and original source metadata through the real route", async () => {
  let stored: OneCMaterialsSnapshot | undefined;
  let metadata: OneCMaterialsImportMetadata | undefined;
  const service = new OneCMaterialImportService({
    saveSnapshot: async (snapshot, source) => {
      stored = snapshot;
      metadata = source;
      return { created: 1, updated: 0, unchanged: 0, batchId: "11111111-1111-4111-8111-111111111111" };
    },
  });
  const code = ts.transpileModule(readFileSync("app/api/integrations/1c/materials/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    "@/lib/server/application": { getApplicationServices: () => ({ oneCMaterials: service }) },
    "@/lib/server/observability": {
      observeHttpRequest: (req: Request, route: string, handler: () => Promise<Response>) =>
        observeHttpRequest(req, route, handler, { sink: () => undefined }),
    },
    "@/lib/server/http/one-c-materials-handler": {
      getOneCMaterialsCapability,
      createOneCMaterialsPostHandler: (deps: Parameters<typeof createOneCMaterialsPostHandler>[0]) =>
        createOneCMaterialsPostHandler({ ...deps, apiKey: () => key }),
    },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", code)((name: string) => {
    if (!(name in dependencies)) throw new Error("Unexpected route dependency: " + name);
    return dependencies[name];
  }, exports);
  const post = exports.POST as (req: Request) => Promise<Response>;
  const response = await post(new Request("https://inventory.example/api/integrations/1c/materials", {
    method: "POST", body: xml,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/xml; charset=utf-8", "x-source-filename": "materials.xml" },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.received, 1);
  assert.equal(body.requestId, response.headers.get("x-request-id"));
  assert.equal(stored?.materials[0].code, "00006135");
  assert.equal(stored?.materials[0].unitPrice, "66784.48");
  assert.equal(stored?.materials[0].responsibleName, "Иванов Иван Иванович");
  assert.equal(stored?.materials[0].responsibleExternalId, "eba5b834-db3b-11f0-a26e-7cc25579bdd7");
  assert.equal(stored?.materials[0].responsibleCode, "001");
  assert.equal(stored?.materials[0].accountCode, "1317");
  assert.equal(stored?.materials[0].balanceSchemaVersion, 2);
  assert.equal(stored?.snapshotAt, "2026-10-14T07:00:00.000Z");
  assert.deepEqual(metadata, {
    requestId: body.requestId, sourceFilename: "materials.xml",
    sourceSha256: createHash("sha256").update(xml).digest("hex"),
  });
});

test("the fixed-assets HTTP contract continues to reject a materials document", async () => {
  let called = false;
  const handler = createOneCFixedAssetsPostHandler({
    apiKey: () => "separate-fixed-assets-key",
    service: {
      tryAcquireLease: async () => ({ release: async () => undefined }),
      importBatch: async () => { called = true; return { received: 1, created: 1, updated: 0, unchanged: 0 }; },
    },
  });
  const response = await handler(new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
    method: "POST", body: xml,
    headers: { authorization: "Bearer separate-fixed-assets-key", "content-type": "application/xml" },
  }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
