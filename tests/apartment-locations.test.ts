import assert from "node:assert/strict";
import test from "node:test";
import { apartmentDesignation, groupApartmentsByMicrodistrict, normalizeApartmentAddress } from "../lib/apartment-locations";
import type { RoomDto } from "../lib/contracts/inventory-locations";

const address = { microdistrict: "32А", house: "12/1", entrance: "2", number: "18" };
const room = (id: string, microdistrict: string): RoomDto => ({
  id, buildingId: "apartments", designation: id, floorNumber: 0, floorLabel: null,
  apartment: { ...address, microdistrict }, qrCode: "", status: "active", version: 1, createdAt: "", updatedAt: "",
});

test("normalizes apartment identifiers and keeps letter and house suffixes", () => {
  assert.deepEqual(normalizeApartmentAddress({ microdistrict: " 032а ", house: "012/1", entrance: "02", number: "018" }), address);
  assert.equal(apartmentDesignation(address), "мкр 32А, дом 12/1, кв. 18");
  for (const invalid of [null, [], {}, { ...address, entrance: "" }, { ...address, house: 12 }, { ...address, number: "1\n2" }, { ...address, microdistrict: "a" }]) {
    assert.throws(() => normalizeApartmentAddress(invalid));
  }
});

test("groups only microdistricts with two apartments and preserves every room exactly once", () => {
  const rooms = [room("first", "32"), room("second", "32"), room("single", "10")];
  const result = groupApartmentsByMicrodistrict(rooms);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].microdistrict, "32");
  assert.equal(result.groups[0].rooms.length, 2);
  assert.deepEqual(result.ungrouped.map(r=>r.id), ["single"]);
  assert.deepEqual(groupApartmentsByMicrodistrict(rooms.slice(1)).groups, []);
  assert.deepEqual(rooms.map(r=>r.id), ["first", "second", "single"]);
});
