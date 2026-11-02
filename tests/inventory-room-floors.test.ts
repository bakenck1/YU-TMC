import assert from "node:assert/strict";
import test from "node:test";

import type { RoomDto } from "../lib/contracts/inventory-locations";
import {
  engineeringFacultyWingFromDesignation,
  groupInventoryRoomsByFloor,
  groupInventoryRoomsByEngineeringFacultyWing,
  groupInventoryRoomsByMainCampusWing,
  isMainCampusWingFloor,
  mainCampusWingFromDesignation,
  normalizeInventoryRoomSearch,
  sortInventoryRoomsForSelection,
} from "../lib/inventory-room-floors";

test("room search matches Cyrillic and Latin lookalikes in both directions and cases", () => {
  const pairs = [
    ["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"],
    ["Н", "H"], ["О", "O"], ["Р", "P"], ["С", "C"], ["Т", "T"],
    ["У", "Y"], ["Х", "X"], ["І", "I"],
  ];
  for (const [cyrillic, latin] of pairs) {
    for (const letter of [cyrillic, latin, cyrillic.toLowerCase(), latin.toLowerCase()]) {
      assert.equal(normalizeInventoryRoomSearch(`${letter}201`), `${latin.toLowerCase()}201`);
      assert.equal(normalizeInventoryRoomSearch(`201 ${letter}`), `201 ${latin.toLowerCase()}`);
    }
  }
  assert.equal(normalizeInventoryRoomSearch("  Ｅ２０１  "), "e201");
  assert.equal(normalizeInventoryRoomSearch("Е\u00a0 201"), "e 201");
  assert.equal(normalizeInventoryRoomSearch("АBС-001"), "abc-001");
});

test("room search preserves digits, distinct letters and ordinary room names", () => {
  for (const [first, second] of [["Р201", "R201"], ["В201", "V201"], ["Е201", "E2010"], ["Е001", "E1"], ["Ә201", "A201"], ["З201", "3201"]]) {
    assert.notEqual(normalizeInventoryRoomSearch(first), normalizeInventoryRoomSearch(second));
  }
  assert.equal(normalizeInventoryRoomSearch("Охрана"), normalizeInventoryRoomSearch(" ОХРАНА "));
  assert.equal(normalizeInventoryRoomSearch("Коридор"), normalizeInventoryRoomSearch(" КОРИДОР "));
  assert.equal(normalizeInventoryRoomSearch(""), "");
});

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

test("discovers engineering wings from letters without a fixed campus list", () => {
  const cases = [
    ["G", "G"],
    [" g ", "G"],
    ["Ｇ", "G"],
    ["g101", "G"],
    ["G-101", "G"],
    ["G/101/2", "G"],
    ["101 G", "G"],
    ["101/2-g", "G"],
    ["G корпус", "G"],
    ["корпус g", "G"],
    ["Кабинет G", "G"],
    ["ж201", "Ж"],
    ["201 Ә", "Ә"],
    ["Қ корпус", "Қ"],
    ["V101", "V"],
    ["Б101", "Б"],
    ["Гараж", null],
    ["Кабинет УИТ", null],
    ["Office", null],
    ["101", null],
    ["", null],
    ["101/2", null],
  ] as const;

  for (const [designation, code] of cases) {
    assert.equal(engineeringFacultyWingFromDesignation(designation), code, designation);
  }
});

test("groups engineering rooms by existing letters and keeps every room exactly once", () => {
  const rooms = [
    room("g10", "G110", 1),
    room("g2", "g102", 1),
    room("z", "Z", 1),
    room("g", "G корпус", 1),
    room("v", "V101", 1),
    room("b", "B101", 1),
    room("named", "Кабинет УИТ", 1),
    room("numbered", "101", 1),
  ];
  const { wings, unassignedRooms } = groupInventoryRoomsByEngineeringFacultyWing(rooms);

  assert.deepEqual(wings.map((wing) => wing.code), ["G"]);
  assert.deepEqual(wings.map((wing) => wing.label), ["G"]);
  assert.deepEqual(wings.find((wing) => wing.code === "G")?.rooms
    .filter((value) => /\d/.test(value.designation)).map((value) => value.id), ["g2", "g10"]);
  assert.deepEqual(new Set(unassignedRooms.map((value) => value.id)),
    new Set(["numbered", "named", "z", "v", "b"]));
  const groupedIds = [...wings.flatMap((wing) => wing.rooms), ...unassignedRooms]
    .map((value) => value.id);
  assert.equal(groupedIds.length, rooms.length);
  assert.deepEqual(new Set(groupedIds), new Set(rooms.map((value) => value.id)));
  assert.deepEqual(rooms.map((value) => value.id), ["g10", "g2", "z", "g", "v", "b", "named", "numbered"]);
  assert.deepEqual(groupInventoryRoomsByEngineeringFacultyWing([]), { wings: [], unassignedRooms: [] });
});

test("rebuilds engineering wings after a room is renamed or removed", () => {
  const initial = room("room", "G101", 1);
  const peer = room("peer", "G102", 1);
  assert.deepEqual(groupInventoryRoomsByEngineeringFacultyWing([initial]).wings, []);
  assert.deepEqual(groupInventoryRoomsByEngineeringFacultyWing([initial, peer]).wings
    .map((wing) => wing.code), ["G"]);
  const renamed = { ...initial, designation: "H101" };
  const afterRename = groupInventoryRoomsByEngineeringFacultyWing([renamed, peer]);
  assert.deepEqual(afterRename.wings, []);
  assert.deepEqual(new Set(afterRename.unassignedRooms), new Set([renamed, peer]));
  const withoutLetter = { ...initial, designation: "101" };
  const groups = groupInventoryRoomsByEngineeringFacultyWing([withoutLetter]);
  assert.deepEqual(groups.wings, []);
  assert.deepEqual(groups.unassignedRooms, [withoutLetter]);
});

test("creates multiple engineering wings only for repeated letters, never repeated names", () => {
  const rooms = [
    room("f1", "F101", 1),
    room("f2", "102 f", 1),
    room("g1", "G103", 1),
    room("g2", "g104", 1),
    room("single", "H105", 1),
    room("guard1", "Охрана", 1),
    room("guard2", "Охрана", 1),
    room("hall1", "Коридор", 1),
    room("hall2", "Коридор", 1),
  ];
  const groups = groupInventoryRoomsByEngineeringFacultyWing(rooms);
  assert.deepEqual(groups.wings.map((wing) => [wing.code, wing.rooms.length]), [["F", 2], ["G", 2]]);
  assert.deepEqual(new Set(groups.unassignedRooms.map((value) => value.id)),
    new Set(["single", "guard1", "guard2", "hall1", "hall2"]));

  const floors = groupInventoryRoomsByFloor([room("f1", "F101", 1), room("f2", "F201", 2)]);
  for (const floor of floors) {
    const floorGroups = groupInventoryRoomsByEngineeringFacultyWing(floor.rooms);
    assert.deepEqual(floorGroups.wings, []);
    assert.equal(floorGroups.unassignedRooms.length, 1);
  }
});

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
  ], 4);

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
    ["Мангышлак A", "A"],
    ["Мангышлак А", "A"],
    ["Кабинет B", "B"],
    ["Кабинет Б", "B"],
    ["Кабинет В", "B"],
    ["Кабинет D", "D"],
    ["Кабинет Д", "D"],
    ["Кабинет E", "E"],
    ["Кабинет Е", "E"],
    ["К201", "K"],
    ["k-201", "K"],
    ["２０１ Ｋ", "K"],
    ["201 К", "K"],
    ["201k", "K"],
    ["Кабинет К", "K"],
    ["Room K", "K"],
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
  assert.equal(mainCampusWingFromDesignation("Комната"), null);
  assert.equal(mainCampusWingFromDesignation("OFFICE"), null);
});

test("groups Cyrillic and Latin K rooms together only on the second floor", () => {
  const groups = groupInventoryRoomsByMainCampusWing([
    room("room-k-ru", "К201", 2),
    room("room-k-en", "K202", 2),
    room("room-k-suffix", "203 к", 2),
  ], 2);
  const kWing = groups.wings.find((wing) => wing.code === "K");
  assert.equal(kWing?.label, "К");
  assert.equal(kWing?.rooms.length, 3);
  assert.deepEqual(groups.unassignedRooms, []);

  const otherFloor = groupInventoryRoomsByMainCampusWing([
    room("room-k-other-floor", "K301", 3),
  ], 3);
  assert.equal(otherFloor.wings.some((wing) => wing.code === "K"), false);
  assert.equal(otherFloor.unassignedRooms.length, 1);
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
    room("room-k-2", "К201", 2),
    room("room-other-2", "Library", 2),
  ]);

  assert.deepEqual(
    sorted.map((value) => value.designation),
    ["A102", "A110", "B105", "D110", "E101", "Library", "B201", "E201", "К201", "Library"],
  );
});
