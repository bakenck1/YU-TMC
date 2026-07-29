import { describe, expect, it } from "vitest";

import { buildCampusMapData } from "@/lib/campus-map-data";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

const building: BuildingDto = {
  id: "main-db-id",
  name: "The Main Campus",
  address: "32-й микрорайон, Актау",
  qrCode: "YUQ1:building",
  roomCount: 1,
  status: "active",
  version: 1,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const room: RoomDto = {
  id: "room-401",
  buildingId: building.id,
  designation: "401",
  floorNumber: 4,
  floorLabel: null,
  qrCode: "YUQ1:room",
  status: "active",
  version: 1,
  createdAt: building.createdAt,
  updatedAt: building.updatedAt,
};

const item: InventoryItemDto = {
  id: "item-1",
  name: "Ноутбук",
  description: null,
  itemType: "Ноутбук",
  brand: "Lenovo",
  model: "ThinkPad",
  quantity: 1,
  unitPrice: 250000,
  inventoryNumberKind: "official",
  inventoryNumber: "INV-001",
  room: {
    id: room.id,
    designation: room.designation,
    floorNumber: room.floorNumber,
    buildingId: building.id,
    buildingName: building.name,
  },
  status: "maintenance",
  qrCode: "YUQ1:item",
  responsible: { id: "user-1", name: "Иван Иванов" },
  photoUrl: null,
  version: 1,
  createdAt: building.createdAt,
  updatedAt: building.updatedAt,
};

describe("buildCampusMapData", () => {
  it("uses the approved floor plan and projects saved rooms and items", () => {
    const data = buildCampusMapData([building], [room], [item]);

    expect(data.buildings["main-campus"]).toMatchObject({
      name: "The Main Campus",
      floorCount: 15,
      total: 1,
      attn: 1,
    });
    expect(data.buildings.kgise.floorCount).toBe(4);
    expect(data.buildings["yessenov-technopark"].floorCount).toBe(2);
    expect(data.buildings["marine-academy"].floorCount).toBe(3);
    expect(data.buildings["sports-complex"].floorCount).toBe(2);
    expect(data.buildings["dormitory-1"].floorCount).toBe(5);
    expect(data.buildings["dormitory-2"].floorCount).toBe(5);
    expect(data.buildings["main-campus"].floors[3].rooms[0]).toMatchObject({
      code: "401",
      items: [expect.objectContaining({ id: item.id, status: "service" })],
    });
    expect(data.totals).toEqual({ units: 1, attention: 1, locations: 7 });
  });
});
