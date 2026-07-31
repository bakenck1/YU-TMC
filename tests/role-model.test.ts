import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { USER_ROLES } from "../lib/contracts/users";
import { translate } from "../lib/i18n";
import { isAuthRole } from "../lib/security/authorization";
import {
  canManageUser,
  hasPermission,
} from "../lib/security/permissions";

test("exposes exactly the three product roles", () => {
  assert.deepEqual(USER_ROLES, ["admin", "warehouse", "employee"]);
  assert.equal(isAuthRole("owner"), false);
  assert.equal(translate("ru", "auth.roleWarehouse"), "Кладовщик");
  assert.equal(translate("kk", "auth.roleWarehouse"), "Қоймашы");
  assert.equal(translate("en", "auth.roleWarehouse"), "Warehouse keeper");
});

test("warehouse can scan and record presence without inventory mutation rights", () => {
  const allowed = [
    "inventory.workspace.read",
    "inventory.item.read_all",
    "inventory.qr.resolve_full",
    "inventory.inspection.create_self",
    "inventory.inspection.read_own",
    "inventory.inspection.mutate_own_draft",
    "inventory.result.record_own_inspection",
  ] as const;
  const denied = [
    "legacy.locations.read",
    "legacy.analytics.read",
    "inventory.building.create",
    "inventory.room.create",
    "inventory.item.create",
    "inventory.item.edit_content",
    "inventory.item.send_to_service",
    "inventory.item.manage_protected_fields",
    "inventory.item.bulk_manage",
    "inventory.transfer.override",
  ] as const;

  allowed.forEach((permission) => {
    assert.equal(hasPermission("warehouse", permission), true, permission);
  });
  denied.forEach((permission) => {
    assert.equal(hasPermission("warehouse", permission), false, permission);
  });
  assert.equal(
    canManageUser("admin", { currentRole: "admin", nextRole: "warehouse" }),
    true,
  );
  assert.equal(
    canManageUser("warehouse", { nextRole: "employee" }),
    false,
  );
});

test("role migration converts active owners before replacing the auth enum", () => {
  const migration = readFileSync(
    new URL(
      "../drizzle/20260731092658_dashing_scarlet_spider.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const convertIndex = migration.indexOf(
    `UPDATE "yu_inventory"."users" SET "role" = 'admin' WHERE "role" = 'owner'`,
  );
  const dropIndex = migration.indexOf(
    `DROP TYPE "yu_inventory"."auth_role"`,
  );

  assert.ok(convertIndex >= 0);
  assert.ok(dropIndex > convertIndex);
  assert.match(
    migration,
    /CREATE TYPE "yu_inventory"\."auth_role" AS ENUM\('admin', 'warehouse', 'employee'\)/,
  );
});
