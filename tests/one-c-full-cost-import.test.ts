import assert from "node:assert/strict";
import test from "node:test";
import { OneCFixedAssetImportService } from "../lib/application/services/one-c-fixed-asset-import-service";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import { createOneCFixedAssetsPostHandler } from "../lib/server/http/one-c-fixed-assets-handler";
import { createOneCMaterialsPostHandler, getOneCMaterialsCapability } from "../lib/server/http/one-c-materials-handler";
import type { OneCMaterialsSnapshot } from "../lib/contracts/one-c-materials";
import { OneCMaterialImportService } from "../lib/application/services/one-c-material-import-service";
import type { ExcelSourceRow } from "../lib/inventory-source-audit";

const GUID = "00000000-0000-4000-8000-000000000001";
const SECOND_GUID = "00000000-0000-4000-8000-000000000002";
const KEY = "full-cost-import-test";
function row(guid: string, fields: string) {
  return `<FixedAsset><GUID>${guid}</GUID><Name>Моноблок</Name>${fields}</FixedAsset>`;
}
function boundary() {
  const batches: OneCFixedAsset[][] = [];
  let releases = 0;
  const handler = createOneCFixedAssetsPostHandler({
    apiKey: () => KEY,
    service: new OneCFixedAssetImportService({
      saveBatch: async assets => {
        batches.push([...assets]);
        return { created: assets.length, updated: 0, unchanged: 0 };
      },
      tryAcquireLease: async () => ({ release: async () => { releases++; } }),
    }),
  });
  return {
    batches, releases: () => releases,
    send: (rows: string) => handler(new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
      method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/xml" },
      body: `<FixedAssets>${rows}</FixedAssets>`,
    })),
  };
}

test("missing initial costs reject the whole batch with object identities and release the lease", async () => {
  const api = boundary();
  const response = await api.send(row(GUID, "<InitialCost>186990.00</InitialCost>")
    + row(SECOND_GUID, "<Code>00012</Code><ResidualValue>0</ResidualValue>"));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error, "initial_cost_required");
  assert.equal(body.invalidRecords, 1);
  assert.deepEqual(body.issues, [{ row: 2, externalId: SECOND_GUID, code: "00012", field: "InitialCost", reason: "missing_initial_cost" }]);
  assert.equal(body.requestId, response.headers.get("x-request-id"));
  assert.deepEqual(api.batches, []);
  assert.equal(api.releases(), 1);

  for (const fields of ["<InitialCost/>", "<ResidualValue>186990</ResidualValue>"]) {
    const rejected = await api.send(row(GUID, fields));
    assert.equal(rejected.status, 422);
  }
  assert.deepEqual(api.batches, []);
  const corrected = await api.send(row(GUID, "<InitialCost>186990.00</InitialCost><ResidualValue>0</ResidualValue>"));
  assert.equal(corrected.status, 200);
  assert.equal(api.batches.length, 1);
  assert.equal(api.releases(), 4);
});

test("unusable or invalid initial costs never reach persistence", async () => {
  const api = boundary();
  for (const amount of ["-1", "abc", "NaN", "Infinity", "100.001", "1000000000000", "0.001"]) {
    const response = await api.send(row(GUID, `<InitialCost>${amount}</InitialCost>`));
    assert.ok([400, 422].includes(response.status), amount);
  }
  assert.deepEqual(api.batches, []);
});

test("large incomplete exports report total problems and bound issue details", async () => {
  const api = boundary();
  const rows = Array.from({ length: 105 }, (_, index) => row(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, "")).join("");
  const response = await api.send(rows);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.invalidRecords, 105);
  assert.equal(body.issues.length, 100);
  assert.equal(body.issuesTruncated, true);
  assert.equal(body.issues[0].reason, "missing_initial_cost");
  assert.deepEqual(api.batches, []);
});

test("each individual item receives its own initial cost even when all residual values are zero", async () => {
  const api = boundary();
  const response = await api.send(
    row(GUID, "<Code>00012</Code><InventoryNumber>1350/14444</InventoryNumber><InitialCost>186990.00</InitialCost><ResidualValue>0</ResidualValue><Quantity>1</Quantity>")
    + row(SECOND_GUID, "<Code>00013</Code><InventoryNumber>1350/14445</InventoryNumber><InitialCost>27440,50</InitialCost><ResidualValue>0</ResidualValue><Quantity>1</Quantity>"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).received, 2);
  const assets = api.batches[0];
  assert.deepEqual(assets.map(asset => [asset.externalId, asset.initialCost, asset.residualCost]), [
    [GUID, 186990, 0], [SECOND_GUID, 27440.5, 0],
  ]);
  const cards = assets.map((asset, index) => ({
    id: `card-${index}`, name: asset.name, inventoryNumber: asset.inventoryNumber!,
    inventoryNumberKind: "official", oneCCode: null, officialBarcodes: [], sourceCodes: [],
    version: 1, itemSection: "general", status: "active", unitPrice: "0.00",
  }));
  const audit = buildInventorySourceAudit(cards, assets.map(asset => ({ externalId: asset.externalId, asset })), [], []);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, cards);
  addOneCPriceProposals(plan, audit.rows, new Map(assets.map(asset => [asset.externalId, asset])), cards, { independentSources: true });
  assert.deepEqual(plan.rows.map(item => [item.itemId, item.price?.nextUnitPrice, item.price?.source]), [
    ["card-0", "186990.00", "os_initial_cost"], ["card-1", "27440.50", "os_initial_cost"],
  ]);
  assert.equal(plan.counts.ready, 2);
});

test("positive legacy aliases remain accepted for full initial cost", async () => {
  for (const tag of ["InitialValue", "ПервоначальнаяСтоимость"]) {
    const api = boundary();
    assert.equal((await api.send(row(GUID, `<${tag}>186990.00</${tag}><ResidualValue>0</ResidualValue>`))).status, 200);
    assert.equal(api.batches[0][0].initialCost, 186990);
  }
});

function materialRow(code: string, fields: string) {
  return `<Material><Code>${code}</Code><Name>МФУ</Name><AccountCode>1317</AccountCode>${fields}</Material>`;
}
function materialsBoundary() {
  const snapshots: OneCMaterialsSnapshot[] = [];
  const handler = createOneCMaterialsPostHandler({
    apiKey: () => KEY,
    service: new OneCMaterialImportService({ saveSnapshot: async snapshot => {
      snapshots.push(snapshot);
      return { created: snapshot.materials.length, updated: 0, unchanged: 0, batchId: "priced-materials" };
    } }),
  });
  return { snapshots, send: (rows: string) => handler(new Request("https://inventory.example/api/integrations/1c/materials", {
    method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/xml" },
    body: `<Materials><SchemaVersion>2</SchemaVersion><SnapshotAt>2026-11-04T12:00:00+05:00</SnapshotAt>${rows}</Materials>`,
  })) };
}

test("materials require a nonnegative usable unit price for every positive balance and identify the exact MOL", async () => {
  const capability = await getOneCMaterialsCapability("").json();
  assert.equal(capability.pricing.field, "UnitPrice");
  assert.equal(capability.pricing.requiredFor, "positive_quantity");
  const api = materialsBoundary();
  for (const [field, reason] of [["", "missing_unit_price"], ["<UnitPrice/>", "missing_unit_price"], ["<UnitPrice>1000000000000</UnitPrice>", "invalid_unit_price"]]) {
    const response = await api.send(materialRow("00012", `<Quantity>1</Quantity><ResponsibleCode>001</ResponsibleCode>${field}`));
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, "unit_price_required");
    assert.equal(body.invalidRecords, 1);
    assert.equal(body.requestId, response.headers.get("x-request-id"));
    assert.equal(body.issues[0].code, "00012");
    assert.equal(body.issues[0].accountCode, "1317");
    assert.equal(body.issues[0].responsibleCode, "001");
    assert.equal(body.issues[0].reason, reason);
  }
  assert.deepEqual(api.snapshots, []);
  assert.equal((await api.send(materialRow("00012", "<Quantity>1</Quantity><UnitPrice>186990.00</UnitPrice>"))).status, 200);
});

test("zero and negative balance updates remain possible without a price", async () => {
  const api = materialsBoundary();
  const response = await api.send(materialRow("zero", "<Quantity>0</Quantity><UnitPrice>0</UnitPrice>")
    + materialRow("negative", "<Quantity>-1</Quantity>"));
  assert.equal(response.status, 200);
  assert.deepEqual(api.snapshots[0].materials.map(material => [material.quantity, material.unitPrice]), [["0", "0"], ["-1", null]]);
});

test("an incomplete material balance rejects the complete package before storage", async () => {
  const api = materialsBoundary();
  const response = await api.send(materialRow("valid", "<Quantity>7</Quantity><UnitPrice>9100</UnitPrice>")
    + materialRow("missing", "<Quantity>1</Quantity>"));
  assert.equal(response.status, 422);
  assert.deepEqual(api.snapshots, []);
  const body = await response.json();
  assert.equal(body.issues[0].row, 2);
  const bulk = await api.send(Array.from({ length: 105 }, (_, index) => materialRow(`code-${index}`, "<Quantity>1</Quantity>")).join(""));
  const problems = await bulk.json();
  assert.equal(problems.invalidRecords, 105);
  assert.equal(problems.issues.length, 100);
  assert.equal(problems.issuesTruncated, true);
});

test("material unit prices stay separate by MOL without using the total balance amount", async () => {
  const api = materialsBoundary();
  const response = await api.send(
    materialRow("00012", "<Quantity>7</Quantity><UnitPrice>9100.50</UnitPrice><InventoryNumber>1350/14444</InventoryNumber><Responsible>Иванов</Responsible><ResponsibleCode>001</ResponsibleCode>")
    + materialRow("00012", "<Quantity>15</Quantity><UnitPrice>12000.25</UnitPrice><InventoryNumber>1350/14445</InventoryNumber><Responsible>Петров</Responsible><ResponsibleCode>002</ResponsibleCode>"),
  );
  assert.equal(response.status, 200);
  const materials = api.snapshots[0].materials;
  const cards = materials.map((material, index) => ({
    id: `card-${index}`, name: material.name, inventoryNumber: material.inventoryNumber!,
    inventoryNumberKind: "official", oneCCode: material.code, officialBarcodes: [], sourceCodes: [],
    responsibleName: material.responsibleName, version: 1, itemSection: "general", status: "active", unitPrice: "0.00",
  }));
  const rows: ExcelSourceRow[] = materials.map((material, index) => ({
    rowNumber: index + 1, sourceKind: "materials_api", sourceKey: `balance-${index}`, oneCCode: material.code,
    nomenclature: material.name, inventoryNumber: material.inventoryNumber!, explicitInventoryNumber: material.inventoryNumber,
    endingBalance: material.quantity, unitPrice: material.unitPrice, responsibleName: material.responsibleName,
  }));
  const audit = buildInventorySourceAudit(cards, [], rows, []);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, cards, { allowSourceCode: true });
  addOneCPriceProposals(plan, audit.rows, new Map(), cards, { independentSources: true });
  assert.deepEqual(plan.rows.map(item => [item.itemId, item.price?.nextUnitPrice, item.price?.source]), [
    ["card-0", "9100.50", "material_unit_price"], ["card-1", "12000.25", "material_unit_price"],
  ]);
});


test("zero prices are accepted for fixed assets and positive material balances", async () => {
  const assets = boundary();
  assert.equal((await assets.send(row(GUID, "<InitialCost>0</InitialCost>") + row(SECOND_GUID, "<InitialCost>100</InitialCost>"))).status, 200);
  assert.deepEqual(assets.batches[0].map(asset => asset.initialCost), [0, 100]);
  const materials = materialsBoundary();
  assert.equal((await materials.send(materialRow("zero", "<Quantity>1</Quantity><UnitPrice>0</UnitPrice>") + materialRow("priced", "<Quantity>1</Quantity><UnitPrice>100</UnitPrice>"))).status, 200);
  assert.deepEqual(materials.snapshots[0].materials.map(material => material.unitPrice), ["0", "100"]);
});

test("excluded books without prices do not reject priced equipment in the same export", async () => {
  const assets = boundary();
  const book = row(GUID, "").replace("Моноблок", "Книга по оборудованию");
  assert.equal((await assets.send(book + row(SECOND_GUID, "<InitialCost>100</InitialCost>"))).status, 200);
  const materials = materialsBoundary();
  const bookMaterial = materialRow("BOOK", "<Quantity>1</Quantity>").replace("МФУ", "Учебная литература");
  assert.equal((await materials.send(bookMaterial + materialRow("PRINTER", "<Quantity>1</Quantity><UnitPrice>100</UnitPrice>"))).status, 200);
  assert.equal((await materials.send(materialRow("PRINTER", "<Quantity>1</Quantity>"))).status, 422);
  assert.equal((await assets.send(row(SECOND_GUID, ""))).status, 422);
});

test("excluded consumables without prices do not block priced equipment imports", async () => {
  const assets = boundary();
  const supply = row(GUID, "").replace("Моноблок", "Степлер электрический");
  assert.equal((await assets.send(supply + row(SECOND_GUID, "<InitialCost>100</InitialCost>"))).status, 200);
  const materials = materialsBoundary();
  const cable = materialRow("CABLE", "<Quantity>50</Quantity>").replace("МФУ", "Кабель ВВГ 3х2,5");
  assert.equal((await materials.send(cable + materialRow("PRINTER", "<Quantity>1</Quantity><UnitPrice>100</UnitPrice>"))).status, 200);
  assert.equal((await materials.send(materialRow("PRINTER", "<Quantity>1</Quantity>"))).status, 422);
});
