import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

test("service request stores its photo separately from the primary item photo", async () => {
  const dialog = await Promise.all([
    "components/InventoryItemServiceDialog.tsx",
    "components/InventoryItemServiceForm.tsx",
  ].map((relativePath) => readFile(new URL(relativePath, ROOT), "utf8"))).then((sources) => sources.join("\n"));
  const details = await readFile(new URL("components/InventoryItemDetails.tsx", ROOT), "utf8");
  const route = await readFile(new URL("app/api/inventory/items/[id]/route.ts", ROOT), "utf8");
  const service = await readFile(new URL("lib/application/services/inventory-item-service.ts", ROOT), "utf8");
  const repository = await readFile(new URL("lib/server/persistence/postgres/postgres-inventory-item-repositories.ts", ROOT), "utf8");

  assert.match(dialog, /photoRequired && !photoAttached/);
  assert.match(dialog, /service\.attachPhoto/);
  assert.match(details, /photo: servicePhoto/);
  assert.match(details, /item\.servicePhotoUrl/);
  assert.doesNotMatch(details, /photoResponse|version = photoBody/);
  assert.match(route, /body\.photo/);
  assert.match(service, /service_photo_required/);
  assert.match(service, /insertServiceItemPhoto/);
  assert.match(repository, /'service_request'/);
  assert.match(repository, /purpose = 'item' and status = 'attached'/);
  assert.match(route, /notifyMaintenanceRequest/);
  assert.match(route, /user\.role === "employee"/);
});
