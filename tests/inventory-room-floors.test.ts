import assert from "node:assert/strict";
import test from "node:test";

import type { RoomDto } from "../lib/contracts/inventory-locations";
import {
  groupInventoryRoomsByFloor,
  groupInventoryRoomsByMainCampusWing,
  isMainCampusWingFloor,
  mainCampusWingFromDesignation,
  sortInventoryRoomsForSelection,
} from "../lib/inventory-room-floors";

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

test("groups lower main-campus rooms into A, B, D and E wings", () => {
  const groups = groupInventoryRoomsByMainCampusWing([
    room("room-e", "E402", 4),
    room("room-d", "D412", 4),
    room("room-a", "A401", 4),
    room("room-b", "B403", 4),
    room("room-cyrillic-v", "В404", 4),
    room("room-other", "405", 4),
  ]);

  assert.deepEqual(
    groups.wings.map((wing) => [wing.code, wing.label]),
    [
      ["A", "A"],
      ["B", "B"],
      ["D", "D"],
      ["E", "E"],
    ],
  );
  assert.deepEqual(
    new Set(groups.wings[1]?.rooms.map((value) => value.designation)),
    new Set(["B403", "В404"]),
  );
  assert.deepEqual(groups.unassignedRooms.map((value) => value.designation), ["405"]);
  assert.equal(isMainCampusWingFloor(0), true);
  assert.equal(isMainCampusWingFloor(4), true);
  assert.equal(isMainCampusWingFloor(5), false);
});

test("recognizes a campus wing before or after a room number", () => {
  const cases = [
    ["A401", "A"],
    ["А 401", "A"],
    ["401A", "A"],
    ["401 А", "A"],
    ["B-401", "B"],
    ["Б 401", "B"],
    ["401В", "B"],
    ["401 V", "B"],
    ["D/401", "D"],
    ["401 Д", "D"],
    ["E.401", "E"],
    ["401-Е", "E"],
  ] as const;

  for (const [designation, expectedWing] of cases) {
    assert.equal(
      mainCampusWingFromDesignation(designation),
      expectedWing,
      designation,
    );
  }

  assert.equal(mainCampusWingFromDesignation("401"), null);
  assert.equal(mainCampusWingFromDesignation("Office A401"), null);
  assert.equal(mainCampusWingFromDesignation("A office 401"), null);
});

test("sorts room selections by floor, then A, B, D and E wings", () => {
  const sorted = sortInventoryRoomsForSelection([
    room("room-e-2", "E201", 2),
    room("room-d-1", "D110", 1),
    room("room-b-1", "B105", 1),
    room("room-a-10", "A110", 1),
    room("room-other", "Library", 1),
    room("room-a-2", "A102", 1),
    room("room-e-1", "E101", 1),
    room("room-b-2", "B201", 2),
  ]);

  assert.deepEqual(
    sorted.map((value) => value.designation),
    ["A102", "A110", "B105", "D110", "E101", "Library", "B201", "E201"],
  );
});
