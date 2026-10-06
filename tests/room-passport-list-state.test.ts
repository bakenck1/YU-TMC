import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePassportFilters, passportDetailsHref, passportListHref, passportReturnHref } from "@/lib/room-passport-list-state";

test("filter addresses round-trip safely through a passport and ignore malformed values", () => {
  const filters = parsePassportFilters({ building: ["building1", "ignored"], floor: "0", room: "room1", status: "in_review" });
  const href = passportListHref(filters);
  const details = new URL(passportDetailsHref("room1", href), "https://passport.local");
  assert.equal(passportReturnHref(details.searchParams.get("returnTo")), href);
  assert.deepEqual(parsePassportFilters(new URL(href, "https://passport.local").searchParams), filters);
  assert.equal(parsePassportFilters({ floor: "-2" }).floor, "-2");
  assert.deepEqual(parsePassportFilters({ floor: "NaN", status: "bad", room: "x".repeat(101) }), { building: "", floor: "", room: "", status: "" });
  assert.equal(passportReturnHref("/room-passports?status=in_review&unexpected=1#test"), "/room-passports?status=in_review");
});

test("card back links cannot navigate outside the passport list", () => {
  for (const value of [undefined, ["/room-passports"], "https://example.com/room-passports", "//example.com/room-passports", "/items", "/room-passports/room1", "/room-passports-other", "/\\example.com/room-passports", "/room-passports?room=" + "x".repeat(2000)]) {
    assert.equal(passportReturnHref(value), "/room-passports");
  }
});
