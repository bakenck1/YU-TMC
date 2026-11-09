import assert from "node:assert/strict";
import test from "node:test";
import { parseQrIdentifierInput } from "../lib/domain/qr-identifier";

test("a room QR web link resolves to the stored opaque identifier", () => {
  const token = "YUQ1:00000000000000000000000000";
  const result = parseQrIdentifierInput(
    `https://inventory.example/rooms/qr/${encodeURIComponent(token)}`,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.canonicalKey, token);
});

test("desktop navigation exposes requests to every product role", async () => {
  const { sidebarItemsForRole } = await import("../components/Sidebar");
  for (const role of ["admin", "warehouse", "employee"] as const) {
    assert.ok(
      sidebarItemsForRole(role).some((item) => item.href === "/requests"),
      role,
    );
  }
});
