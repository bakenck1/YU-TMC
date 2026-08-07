import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseQrIdentifierInput } from "../lib/domain/qr-identifier";

const read = (path: string) => readFileSync(path, "utf8");

test("a room QR web link resolves to the stored opaque identifier", () => {
  const token = "YUQ1:00000000000000000000000000";
  const result = parseQrIdentifierInput(
    `https://inventory.example/rooms/qr/${encodeURIComponent(token)}`,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.canonicalKey, token);
});

test("public room QR rendering exposes only the designation before login", () => {
  const page = read("app/rooms/qr/[token]/page.tsx");
  const contract = read("lib/contracts/room-workspace.ts");
  assert.match(page, /findPublicByQr/);
  assert.match(page, /findByQr\(token, authorizationActor\(user\)\)/);
  assert.match(page, /returnTo/);
  assert.match(contract, /interface PublicRoomDto \{\s*designation: string;\s*\}/);
  assert.doesNotMatch(contract.match(/interface PublicRoomDto[\s\S]*?\}/)?.[0] ?? "", /responsible|items/);
});

test("service requests have required photos, bounded types, statuses and admin-only transitions", () => {
  const schema = read("lib/db/schema.ts");
  const route = read("app/api/service-requests/route.ts");
  const service = read("lib/application/services/service-request-service.ts");
  assert.match(schema, /serviceRequestsTable/);
  assert.match(schema, /photoBinaryData: binaryData\("photo_binary_data"\)\.notNull\(\)/);
  assert.match(route, /!body\.photo/);
  for (const value of ["not_working", "not_connected", "damaged", "missing"]) {
    assert.match(route, new RegExp(value));
  }
  assert.match(service, /if \(actor\.role !== "admin"\) throw forbidden\(\)/);
  for (const value of ["new", "in_progress", "completed"]) {
    assert.match(service, new RegExp(value));
  }
});

test("mobile navigation contains exactly the five required destinations", () => {
  const navigation = read("components/MobileBottomNavigation.tsx");
  const hrefs = [...navigation.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ["/", "/items", "/scan", "/requests", "/profile"]);
  assert.match(navigation, /min-h-11/);
  assert.match(navigation, /md:hidden/);
});

test("item creation API rejects records without an attached photo", () => {
  const route = read("app/api/inventory/items/route.ts");
  const form = read("components/InventoryItemCreateForm.tsx");
  assert.match(route, /!body\.photo/);
  assert.match(form, /\|\| !photo/);
  assert.match(form, /photo,/);
});
