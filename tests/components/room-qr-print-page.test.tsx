import { beforeEach, describe, expect, it, vi } from "vitest";

import RoomQrPrintPage from "@/app/inventory/rooms/qr-print/page";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";

const { authorize, listBuildings, listRooms } = vi.hoisted(() => ({
  authorize: vi.fn(),
  listBuildings: vi.fn(),
  listRooms: vi.fn(),
}));
vi.mock("@/lib/server/security/page-access", () => ({ requireAuthorizedPage: authorize }));
vi.mock("@/lib/server/security/request-user", () => ({
  authorizationActor: (user: unknown) => user,
}));
vi.mock("@/lib/server/application", () => ({
  getApplicationServices: () => ({ locations: { listBuildings, listRooms } }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not_found"); },
}));
vi.mock("@/lib/campus-directory", () => ({ isInventoryBuildingName: () => true }));
vi.mock("@/components/RoomQrBatchPrintView", () => ({ default: () => null }));

const BUILDING: BuildingDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Main building",
  address: "Campus",
  qrCode: "BUILDING-QR",
  roomCount: 125,
  status: "active",
  version: 1,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};
const ROOMS: RoomDto[] = Array.from({ length: 125 }, (_, index) => ({
  id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
  buildingId: BUILDING.id,
  designation: String(index + 1),
  floorNumber: 1,
  floorLabel: null,
  qrCode: `ROOM-${index}`,
  status: "active",
  version: 1,
  createdAt: BUILDING.createdAt,
  updatedAt: BUILDING.updatedAt,
}));

describe("room QR printing authorization and selection", () => {
  beforeEach(() => {
    authorize.mockResolvedValue({ userId: "printing-1", role: "typography" });
    listBuildings.mockResolvedValue([BUILDING]);
    listRooms.mockResolvedValue(ROOMS);
  });

  it("allows printing staff to print all cabinets, including cabinets beyond the first 100", async () => {
    const page = await RoomQrPrintPage({ searchParams: Promise.resolve({ all: "1" }) });
    expect(page.props.rooms).toEqual(ROOMS);
    expect(page.props.buildings).toEqual([BUILDING]);
  });

  it("prints every selected cabinet without including unrelated cabinets", async () => {
    const selected = ROOMS.slice(1);
    const page = await RoomQrPrintPage({ searchParams: Promise.resolve({ ids: selected.map((room) => room.id).join(",") }) });
    expect(page.props.rooms).toEqual(selected);
  });

  it.each(["warehouse", "employee"])("denies printing to %s before querying cabinets", async (role) => {
    authorize.mockResolvedValue({ userId: "other-1", role });
    await expect(RoomQrPrintPage({ searchParams: Promise.resolve({ all: "1" }) })).rejects.toThrow("not_found");
    expect(listBuildings).not.toHaveBeenCalled();
    expect(listRooms).not.toHaveBeenCalled();
  });
});
