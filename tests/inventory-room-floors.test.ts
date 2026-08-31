import assert from "node:assert/strict";
import test from "node:test";

import type { RoomDto } from "../lib/contracts/inventory-locations";
import { groupInventoryRoomsByFloor } from "../lib/inventory-room-floors";

function room(id: string, designation: string, floorNumber: number): RoomDto {
  return {
    id,
    buildingId: "building-1",
    designation,
    floorNumber,
    floorLabel: null,
    primaryResponsible: null,
    qrCode: `QR-${id}`,
    status: "active",
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

test("groups rooms into sorted floors and naturally sorts room designations", () => {
  const floors = groupInventoryRoomsByFloor([
    room("room-710", "710", 7),
    room("room-102", "102", 1),
    room("room-72", "72", 7),
    room("room-2", "2", 1),
  ]);

  assert.deepEqual(floors.map((floor) => floor.floorNumber), [1, 7]);
  assert.deepEqual(floors[0]?.rooms.map((value) => value.designation), ["2", "102"]);
  assert.deepEqual(floors[1]?.rooms.map((value) => value.designation), ["72", "710"]);
});
