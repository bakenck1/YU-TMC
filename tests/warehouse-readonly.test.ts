import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { InventoryItemRepositories, InventoryItemRepository } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { canAccessPath } from "../lib/security/authorization";
import { hasPermission } from "../lib/security/permissions";

function createItemService() {
  const repositories = {
    items: {} as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-03T00:00:00.000Z") },
    { create: () => "id" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("warehouse is read-only and cannot access inspection workflows", () => {
  const warehouse = "warehouse" as const;

  assert.equal(hasPermission(warehouse, "inventory.item.read_all"), true);
  assert.equal(hasPermission(warehouse, "inventory.report.export"), true);
  assert.equal(canAccessPath(warehouse, "/"), true);
  assert.equal(canAccessPath(warehouse, "/items"), true);
  assert.equal(canAccessPath(warehouse, "/items/decommissioned"), true);
  assert.equal(canAccessPath(warehouse, "/analytics"), true);
  assert.equal(hasPermission(warehouse, "inventory.item.create"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.edit_content"), false);
  assert.equal(
    hasPermission(warehouse, "inventory.item.manage_protected_fields"),
    false,
  );
  assert.equal(hasPermission(warehouse, "inventory.item.send_to_service"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.bulk_manage"), false);

  assert.equal(hasPermission(warehouse, "inventory.inspection.create_self"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.read_own"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.mutate_own_draft"), false);
  assert.equal(hasPermission(warehouse, "inventory.result.record_own_inspection"), false);
  assert.equal(canAccessPath(warehouse, "/inventory/inspections"), false);
  assert.equal(canAccessPath(warehouse, "/inventory"), false);
  assert.equal(canAccessPath(warehouse, "/users"), false);
  assert.equal(canAccessPath(warehouse, "/settings"), false);
});

test("warehouse item mutations are rejected by the service before repository access", async () => {
  const service = createItemService();
  const actor = { userId: "warehouse-1", role: "warehouse" as const };
  const forbiddenMutations = [
    service.createItem({} as never, actor),
    service.importItems([] as never, actor),
    service.updateContent("item-1", {} as never, actor),
    service.updatePhoto("item-1", {} as never, actor),
    service.updateProtected("item-1", {} as never, actor),
    service.archiveItem("item-1", 1, actor),
    service.sendToService("item-1", 1, {} as never, actor),
    service.addComponent("item-1", "item-2", actor),
    service.removeComponent("item-1", "item-2", actor),
    service.addComment("item-1", {} as never, actor),
  ];

  for (const mutation of forbiddenMutations) {
    await assert.rejects(mutation, /forbidden/);
  }
});

test("legacy item details hide every inventory mutation control by default", () => {
  const detailsSource = readFileSync("components/ItemDetails.tsx", "utf8");
  const pageSource = readFileSync("app/(protected)/items/[id]/page.tsx", "utf8");

  assert.match(detailsSource, /canManage = false/);
  assert.match(detailsSource, /canManage \|\| tab\.id === "info"/);
  assert.match(detailsSource, /canManage \? <button[^>]*>[\s\S]*?items\.createQr/);
  assert.match(pageSource, /canManage=\{hasPermission\(user\.role, "inventory\.item\.edit_content"\)\}/);
});
