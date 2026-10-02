import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import MobileBottomNavigation from "@/components/MobileBottomNavigation";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ language: "ru", t: (key: string) => key }),
}));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: { role: "typography" } }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/inventory" }));
vi.mock("@/components/InventoryItemCreateForm", () => ({ default: () => null }));
vi.mock("@/components/InventoryRoomQrScanner", () => ({ default: () => null }));
vi.mock("@/components/InventoryBuildingFormModal", () => ({ default: () => null }));
vi.mock("@/components/InventoryRoomFormModal", () => ({ default: () => null }));

const BUILDING: BuildingDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Building",
  address: "Campus",
  qrCode: "BUILDING-QR",
  roomCount: 1,
  status: "active",
  version: 1,
  createdAt: "2026-10-02T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
};
const ROOM: RoomDto = {
  id: "22222222-2222-4222-8222-222222222222",
  buildingId: BUILDING.id,
  designation: "101",
  floorNumber: 1,
  floorLabel: null,
  accessMode: "closed",
  qrCode: "ROOM-QR",
  status: "active",
  version: 1,
  createdAt: BUILDING.createdAt,
  updatedAt: BUILDING.updatedAt,
};

describe("printing staff workspace", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rooms: [ROOM] }),
    }));
  });

  it("offers only facilities and cabinet scanning in mobile navigation", () => {
    render(<MobileBottomNavigation />);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/inventory", "/scan"]);
  });

  it("opens cabinets and prints selected or all QR codes without management actions", async () => {
    render(<InventoryBuildingsManager actorRole="typography" initialBuildings={[BUILDING]} />);
    fireEvent.click(screen.getByRole("button", { name: /inventory.roomsCount/ }));
    await screen.findByText("101");
    fireEvent.click(screen.getByText("1 inventory.floorShort"));

    expect(screen.getByRole("link", { name: "common.open" }).getAttribute("href"))
      .toBe(`/rooms/${ROOM.id}?returnTo=%2Finventory`);
    expect(screen.getByRole("link", { name: "room.qrDownload" }).getAttribute("href"))
      .toBe(`/api/inventory/rooms/${ROOM.id}/qr?download=1`);
    for (const name of ["inventory.addBuilding", "inventory.addRoom", "building.archiveBuilding", "room.openAccessAction", "room.closeAccessAction", "building.scanRoom"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }

    fireEvent.click(screen.getByRole("checkbox", { name: "room.selectForPrint: 101" }));
    fireEvent.click(screen.getByRole("button", { name: "room.qrPrint (1)" }));
    expect(window.open).toHaveBeenCalledWith(`/inventory/rooms/qr-print?ids=${ROOM.id}`, "_blank", "noopener,noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "room.qrPrintAll" }));
    expect(window.open).toHaveBeenCalledWith("/inventory/rooms/qr-print?all=1", "_blank", "noopener,noreferrer");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
