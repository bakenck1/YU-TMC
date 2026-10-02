import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItemRepositories } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { toInventoryItemView } from "../lib/inventory-item-view";
import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

function sourceFixture(identifiers?: unknown, names?: unknown) {
  const queries: string[] = [];
  const source = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [{
        id: "11111111-1111-4111-8111-111111111111", name: "Моноблок",
        item_type: "electronics", one_c_code: null, inventory_number: "INV-001",
        inventory_number_kind: "official", search_identifiers: identifiers,
        search_names: names,
        room_id: "room-1", room_designation: "101", floor_number: 1,
        building_id: "building-1", building_name: "Main", status: "active",
        quantity: 1, unit_price: 0, version: 1,
        created_at: new Date("2026-09-01T00:00:00Z"),
        updated_at: new Date("2026-09-01T00:00:00Z"), archived_at: null,
      }], rowCount: 1 };
    },
  } as unknown as PostgresRepositorySource;
  return { source, queries };
}

test("published 1C search identifiers survive repository, DTO and UI projection without replacing official fields", async () => {
  const identifiers = ["00000001491", "SOURCE-002", "0000012345678"];
  const { source } = sourceFixture(identifiers);
  const repositories = createPostgresInventoryItemRepositories(source);
  const records = await repositories.items.listItems();
  assert.deepEqual(records[0]?.searchIdentifiers, identifiers);
  const unitOfWork = {
    transaction: async (work: (repos: InventoryItemRepositories) => unknown) => work(repositories),
  } as UnitOfWork<InventoryItemRepositories>;
  const service = new InventoryItemService(unitOfWork, { now: () => new Date() },
    { create: () => "unused" }, { create: () => new Uint8Array(16) }, { next: () => "unused" });
  const [dto] = await service.listItems({ userId: "admin-1", role: "admin" });
  assert.deepEqual(dto?.searchIdentifiers, identifiers);
  const view = toInventoryItemView(dto!);
  assert.deepEqual(view.searchIdentifiers, identifiers);
  assert.equal(view.inventoryNumber, "INV-001");
  assert.equal(view.oneCCode, undefined);
});

test("identifier query considers every linked asset and only its latest published barcode", async () => {
  const { source, queries } = sourceFixture([]);
  await createPostgresInventoryItemRepositories(source).items.listItems();
  const sql = queries[0]!;
  assert.match(sql, /item_one_c_links/);
  assert.match(sql, /source_code/);
  assert.match(sql, /source_inventory_number/);
  assert.match(sql, /payload\s*->>\s*'barcode'/);
  assert.match(sql, /review_state\s*=\s*'published'/);
  assert.match(sql, /published_item_id\s*=\s*i\.id/);
  assert.match(sql, /external_id\s*=\s*l\.external_id/);
  assert.match(sql, /order by\s+[^\n]*published_at desc nulls last/);
  assert.match(sql, /array_agg\(distinct/);
  assert.doesNotMatch(sql, /one_c_fixed_asset_inbox/);
});

test("legacy rows without supplemental identifiers expose an empty search array", async () => {
  const { source } = sourceFixture();
  const [record] = await createPostgresInventoryItemRepositories(source).items.listItems();
  assert.deepEqual(record?.searchIdentifiers, []);
});

test("published 1C name aliases survive the projection without replacing the catalogue name", async () => {
  const names = ["Моноблок бухгалтерия"];
  const { source } = sourceFixture([], names);
  const repositories = createPostgresInventoryItemRepositories(source);
  const [record] = await repositories.items.listItems();
  assert.deepEqual(record?.searchNames, names);
  const unitOfWork = {
    transaction: async (work: (repos: InventoryItemRepositories) => unknown) => work(repositories),
  } as UnitOfWork<InventoryItemRepositories>;
  const service = new InventoryItemService(unitOfWork, { now: () => new Date() },
    { create: () => "unused" }, { create: () => new Uint8Array(16) }, { next: () => "unused" });
  const [dto] = await service.listItems({ userId: "admin-1", role: "admin" });
  assert.deepEqual(dto?.searchNames, names);
  const view = toInventoryItemView(dto!);
  assert.deepEqual(view.searchNames, names);
  assert.equal(view.name, "Моноблок");
});
