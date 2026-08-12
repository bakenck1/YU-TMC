import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the employee home keeps the assigned-item map without embedding the transfer panel", () => {
  const page = readFileSync("app/(protected)/page.tsx", "utf8");
  const dashboard = readFileSync("components/Dashboard.tsx", "utf8");

  assert.match(page, /services\.items\.listItems\(actor\)/);
  assert.match(page, /buildCampusMapData\(buildings, rooms, items\)/);
  assert.doesNotMatch(page, /employeeItems/);
  assert.doesNotMatch(dashboard, /InventoryTransfersManager/);
  assert.doesNotMatch(dashboard, /Передача ТМЦ/);
});

test("every authenticated role has a profile route and a profile navigation entry", () => {
  const page = readFileSync("app/(protected)/profile/page.tsx", "utf8");
  const profile = [
    "components/UserProfileCard.tsx",
    "components/UserProfileHeader.tsx",
    "components/UserProfileRoleCard.tsx",
    "components/UserEmailVerificationCard.tsx",
    "lib/user-profile-presentation.ts",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  const sidebar = ["components/Sidebar.tsx", "components/SidebarContent.tsx"]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const authorization = readFileSync("lib/security/authorization.ts", "utf8");

  assert.match(page, /requireAuthorizedPage\("\/profile"\)/);
  assert.match(page, /getProfile/);
  assert.match(profile, /Профиль/);
  assert.match(profile, /email/);
  assert.match(profile, /role/);
  assert.match(profile, /getProfileInitials/);
  assert.match(profile, /USER_PROFILE_ROLE_COPY/);
  assert.match(profile, /bg-gradient-to-br/);
  assert.match(profile, /Email подтверждён/);
  assert.match(sidebar, /\/profile/);
  assert.match(authorization, /\["\/profile", "legacy\.dashboard\.read"\]/);
});
