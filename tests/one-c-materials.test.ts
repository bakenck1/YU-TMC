import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { materialIdentityKey, type OneCMaterialsSnapshot, type OneCMaterialsImportMetadata } from "@/lib/contracts/one-c-materials";
import { OneCMaterialsImportError } from "@/lib/application/ports/one-c-materials-repository";
import { createOneCMaterialsPostHandler, getOneCMaterialsCapability } from "@/lib/server/http/one-c-materials-handler";
import { MAX_ONE_C_MATERIALS_RECORDS, MAX_ONE_C_MATERIALS_XML_BYTES, parseOneCMaterials } from "@/lib/server/integrations/one-c-materials";

const KEY = "test-materials-api-key";
const ROW = "<Material><Code>0000006135</Code><Name>МФУ Laser Jet M130 №1350/1444</Name><Quantity>1</Quantity></Material>";
function xml(rows = ROW, date = "2026-10-14T13:11:41+05:00") { return `<Materials><SnapshotAt>${date}</SnapshotAt>${rows}</Materials>`; }
function request(body: string | Uint8Array = xml(), headers: Record<string, string> = {}) {
  return new Request("https://inventory.example/api/integrations/1c/materials", {
    method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/xml; charset=utf-8", ...headers },
    body: typeof body === "string" ? body : new Uint8Array(body).buffer,
  });
}
function successfulService() {
  return { importSnapshot: async (snapshot: OneCMaterialsSnapshot) => ({ received: snapshot.materials.length, created: snapshot.materials.length, updated: 0, unchanged: 0, batchId: "batch-test" }) };
}

describe("1C materials XML contract", () => {
  it("accepts optional responsible name and GUID independently without changing material identity", () => {
    const base = parseOneCMaterials(xml()).materials[0];
    const id = "EBA5B834-DB3B-11F0-A26E-7CC25579BDD7";
    for (const [fields, expected] of [
      ["<Responsible>  Иванов Иван Иванович  </Responsible>", { responsibleName: "Иванов Иван Иванович" }],
      [`<ResponsibleGUID>${id}</ResponsibleGUID>`, { responsibleExternalId: id.toLowerCase() }],
      [`<Responsible>Иванов &amp; Петров</Responsible><ResponsibleGUID>${id}</ResponsibleGUID>`, { responsibleName: "Иванов & Петров", responsibleExternalId: id.toLowerCase() }],
    ] as const) {
      const parsed = parseOneCMaterials(xml(ROW.replace("</Material>", fields + "</Material>"))).materials[0];
      assert.deepEqual(parsed, { ...base, ...expected });
      assert.equal(materialIdentityKey(parsed), materialIdentityKey(base));
    }
  });
  it("preserves the legacy payload and hash when responsible fields are empty or omitted", () => {
    const legacy = {
      externalId: null, code: "0000006135", name: "МФУ Laser Jet M130 №1350/1444",
      warehouseExternalId: null, warehouseCode: null, warehouseName: null,
      inventoryNumber: null, barcode: null, unit: null, quantity: "1", unitPrice: null, currency: "KZT",
    };
    for (const fields of ["", "<Responsible/><ResponsibleGUID/>", "<Responsible> </Responsible><ResponsibleGUID> </ResponsibleGUID>"]) {
      const parsed = parseOneCMaterials(xml(ROW.replace("</Material>", fields + "</Material>"))).materials[0];
      assert.equal(JSON.stringify(parsed), JSON.stringify(legacy));
    }
  });
  it("rejects malformed, repeated, nested and oversized responsible fields", () => {
    for (const [fields, error] of [
      ["<ResponsibleGUID>not-a-guid</ResponsibleGUID>", "invalid_responsibleguid"],
      ["<Responsible>Иванов</Responsible><Responsible>Петров</Responsible>", "invalid_responsible"],
      ["<Responsible><Name>Иванов</Name></Responsible>", "invalid_responsible"],
      [`<Responsible>${"a".repeat(256)}</Responsible>`, "text_too_long"],
    ]) assert.throws(() => parseOneCMaterials(xml(ROW.replace("</Material>", fields + "</Material>"))), new RegExp(error));
  });
  it("keeps leading zeros, optional missing price/barcode, and explicit unknown warehouse", () => {
    const result = parseOneCMaterials(xml());
    assert.equal(result.snapshotAt, "2026-10-14T08:11:41.000Z");
    const material = result.materials[0];
    assert.equal(material.code, "0000006135");
    assert.equal(material.quantity, "1");
    assert.equal(material.unitPrice, null);
    assert.equal(material.barcode, null);
    assert.equal(material.currency, "KZT");
    assert.equal(materialIdentityKey(material), '["0000006135","unspecified"]');
  });
  it("retains different prices and quantities for one material across warehouses", () => {
    const first = ROW.replace("</Material>", "<WarehouseCode>001</WarehouseCode><WarehouseName>Главный</WarehouseName><UnitPrice>66 784,48</UnitPrice><Barcode/></Material>");
    const second = ROW.replace("<Quantity>1</Quantity>", "<Quantity>-3,125</Quantity>").replace("</Material>", "<WarehouseCode>002</WarehouseCode><UnitPrice>0</UnitPrice></Material>");
    const result = parseOneCMaterials(xml(first + second));
    assert.equal(result.materials.length, 2);
    assert.equal(result.materials[0].unitPrice, "66784.48");
    assert.equal(result.materials[1].quantity, "-3.125");
    assert.equal(result.materials[1].unitPrice, "0");
    assert.notEqual(materialIdentityKey(result.materials[0]), materialIdentityKey(result.materials[1]));
  });
  it("rejects ambiguous warehouse identity and duplicate keys even if GUIDs differ", () => {
    assert.throws(() => parseOneCMaterials(xml(ROW.replace("</Material>", "<WarehouseName>Склад 1</WarehouseName></Material>"))), /warehouse_identity_required/);
    assert.throws(() => parseOneCMaterials(xml(ROW + ROW)), /duplicate_material_warehouse/);
    const a = ROW.replace("</Material>", "<GUID>eba5b834-db3b-11f0-a26e-7cc25579bdd7</GUID><WarehouseCode>001</WarehouseCode></Material>");
    const b = ROW.replace("</Material>", "<GUID>eba5b835-db3b-11f0-a26e-7cc25579bdd7</GUID><WarehouseCode>002</WarehouseCode></Material>");
    assert.throws(() => parseOneCMaterials(xml(a + b)), /conflicting_material_guid/);
  });
  it("decodes standard XML escaping but rejects DTD, namespaces, OS wrappers, and unknown fields", () => {
    assert.equal(parseOneCMaterials(xml(ROW.replace("МФУ Laser Jet M130 №1350/1444", "Printer &amp; scanner"))).materials[0].name, "Printer & scanner");
    for (const [input, error] of [
      ["<!DOCTYPE Materials [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>" + xml(), "xml_entities_not_supported"],
      [xml().replace("<Materials>", '<Materials xmlns="urn:materials">'), "xml_namespaces_not_supported"],
      ["<FixedAssets><FixedAsset/></FixedAssets>", "invalid_root"],
      [xml(ROW.replace("</Material>", "<Unknown>value</Unknown></Material>")), "unsupported_field"],
      [xml(ROW.replace("</Material>", "<Code>second</Code></Material>")), "invalid_code"],
    ]) assert.throws(() => parseOneCMaterials(input), new RegExp(error));
  });
  it("requires a real snapshot timestamp with timezone and rejects impossible calendar dates", () => {
    for (const date of ["", "2026-10-14", "2026-10-14T13:11:41", "2026-02-30T00:00:00Z", "2026-10-14T25:00:00Z", "2026-10-14T12:00:00+14:30"]) {
      assert.throws(() => parseOneCMaterials(xml(ROW, date)), /snapshot_at/);
    }
  });
  it("rejects invalid and over-precision decimals without floating point coercion", () => {
    for (const value of ["NaN", "Infinity", "1e3", "0x10", "1 2", "1.0001", "1000000000000000"]) {
      assert.throws(() => parseOneCMaterials(xml(ROW.replace("<Quantity>1</Quantity>", `<Quantity>${value}</Quantity>`))), /invalid_quantity/);
    }
    for (const value of ["-0.01", "1.001", "10000000000000000"]) {
      assert.throws(() => parseOneCMaterials(xml(ROW.replace("</Material>", `<UnitPrice>${value}</UnitPrice></Material>`))), /invalid_unit_price/);
    }
    const accepted = parseOneCMaterials(xml(ROW.replace("<Quantity>1</Quantity>", "<Quantity>999999999999999.999</Quantity>").replace("</Material>", "<UnitPrice>9999999999999999.99</UnitPrice></Material>"))).materials[0];
    assert.equal(accepted.quantity, "999999999999999.999");
    assert.equal(accepted.unitPrice, "9999999999999999.99");
  });
  it("accepts exactly 50,000 separate material positions", () => {
    const rows = Array.from({ length: MAX_ONE_C_MATERIALS_RECORDS }, (_, index) =>
      ROW.replace("0000006135", String(index).padStart(10, "0")),
    ).join("");
    const parsed = parseOneCMaterials(xml(rows));
    assert.equal(parsed.materials.length, MAX_ONE_C_MATERIALS_RECORDS);
    assert.equal(parsed.materials[0].code, "0000000000");
    assert.equal(parsed.materials.at(-1)?.code, "0000049999");
  });
  it("requires quantity and name and rejects excessive row counts", () => {
    assert.throws(() => parseOneCMaterials(xml(ROW.replace("<Quantity>1</Quantity>", ""))), /quantity_required/);
    assert.throws(() => parseOneCMaterials(xml(ROW.replace(/<Name>.*?<\/Name>/, ""))), /name_required/);
    assert.throws(() => parseOneCMaterials(xml(ROW.repeat(MAX_ONE_C_MATERIALS_RECORDS + 1))), /too_many_records/);
  });
});

describe("1C materials HTTP boundary", () => {
  it("uses separate credentials and reports capability without claiming database readiness", async () => {
    const capability = await getOneCMaterialsCapability("").json();
    assert.equal(capability.service, "1c-materials");
    assert.equal(capability.configured, false);
    assert.equal(capability.automaticPublication, false);
    const handler = createOneCMaterialsPostHandler({ service: successfulService(), apiKey: () => KEY });
    assert.equal((await handler(request(xml(), { authorization: "Bearer fixed-assets-test-key" }))).status, 401);
    assert.equal((await createOneCMaterialsPostHandler({ service: successfulService(), apiKey: () => "" })(request())).status, 503);
    assert.equal((await handler(request(xml(), { "content-type": "application/json" }))).status, 415);
  });
  it("forwards exact source metadata and preserves request ID and authoritative counters", async () => {
    let metadata: OneCMaterialsImportMetadata | undefined;
    const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, service: {
      importSnapshot: async (snapshot, source) => {
        metadata = source;
        assert.equal(snapshot.materials[0].code, "0000006135");
        return { received: 1, created: 0, updated: 0, unchanged: 1, batchId: "batch-replayed", replayed: true };
      },
    } });
    const response = await handler(request(xml(), { "x-source-filename": "materials.xml" }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.batchId, "batch-replayed");
    assert.equal(body.replayed, true);
    assert.equal(body.requestId, response.headers.get("x-request-id"));
    assert.deepEqual(metadata, { sourceSha256: createHash("sha256").update(xml()).digest("hex"), requestId: body.requestId, sourceFilename: "materials.xml" });
  });
  it("bounds declared payloads and rejects malformed UTF8/XML before import", async () => {
    let imports = 0;
    const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, service: { importSnapshot: async () => { imports++; throw new Error("unexpected"); } } });
    assert.equal((await handler(request("x", { "content-length": String(MAX_ONE_C_MATERIALS_XML_BYTES + 1) }))).status, 413);
    const invalidUtf8 = await handler(request(new Uint8Array([0xc3, 0x28])));
    assert.equal((await invalidUtf8.json()).error, "invalid_utf8");
    const invalidXml = await handler(request("<Materials>"));
    assert.equal((await invalidXml.json()).error, "invalid_xml");
    assert.equal(imports, 0);
  });
  it("bounds a stalled body stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined), cancel: () => { cancelled = true; } });
    const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, service: successfulService(), bodyTimeoutMs: 5 });
    const streamed = new Request("https://inventory.example/api/integrations/1c/materials", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "text/xml" }, body, duplex: "half" } as RequestInit & { duplex: "half" });
    const response = await handler(streamed);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "import_timeout");
    assert.equal(cancelled, true);
  });
  it("maps stale/competing snapshots and busy imports safely without exposing DB details", async () => {
    for (const [code, status] of [["stale_snapshot", 409], ["snapshot_conflict", 409], ["import_in_progress", 429], ["store_unavailable", 503], ["import_timeout", 503]] as const) {
      const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, logFailure: () => undefined, service: { importSnapshot: async () => { throw new OneCMaterialsImportError(code, { cause: new Error("secret SQL password") }); } } });
      const response = await handler(request());
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.error, code);
      assert.ok(!JSON.stringify(result).includes("secret"));
    }
  });
  it("rejects overlapping uploads before reading their bodies and releases the slot after completion", async () => {
    let started!: () => void;
    let finish!: () => void;
    const importing = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, service: {
      importSnapshot: async (snapshot) => {
        started();
        await pending;
        return { received: snapshot.materials.length, created: 1, updated: 0, unchanged: 0, batchId: "batch" };
      },
    } });
    const first = handler(request());
    await importing;
    try {
      const second = request();
      const busy = await handler(second);
      assert.equal(busy.status, 429);
      assert.equal(busy.headers.get("retry-after"), "5");
      assert.equal(second.bodyUsed, false);
      assert.equal((await handler(request())).status, 429);
    } finally { finish(); }
    assert.equal((await first).status, 200);
    assert.equal((await handler(request())).status, 200);
  });
  it("releases the in-flight slot after a rejected XML", async () => {
    const handler = createOneCMaterialsPostHandler({ apiKey: () => KEY, service: successfulService() });
    assert.equal((await handler(request("<Materials>"))).status, 400);
    assert.equal((await handler(request())).status, 200);
  });
});
