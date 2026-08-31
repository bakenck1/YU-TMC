import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    language: "ru",
    locale: "ru-RU",
    t: (key: string) => key,
  }),
}));

const BUILDING: BuildingDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Test building",
  address: "Campus",
  qrCode: "YUQ1:BUILDING",
  roomCount: 3,
  status: "active",
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function room(id: string, designation: string, floorNumber: number): RoomDto {
  return {
    id,
    buildingId: BUILDING.id,
    designation,
    floorNumber,
    floorLabel: null,
    primaryResponsible: null,
    qrCode: `QR-${id}`,
    status: "active",
    version: 1,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("building room navigation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a floor list first and keeps rooms inside their floor", async () => {
    const rooms = [
      room("22222222-2222-4222-8222-222222222222", "101", 1),
      room("33333333-3333-4333-8333-333333333333", "701", 7),
      room("44444444-4444-4444-8444-444444444444", "702", 7),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rooms })));

    render(
      <InventoryBuildingsManager
        actorRole="admin"
        initialBuildings={[BUILDING]}
      />,
    );

    const roomsButton = screen.getByRole("button", {
      name: /inventory\.roomsCount: 3/,
    });
    expect(roomsButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(roomsButton);

    await waitFor(() => {
      expect(screen.getByText("1 inventory.floorShort")).toBeTruthy();
      expect(screen.getByText("7 inventory.floorShort")).toBeTruthy();
    });
    expect(roomsButton.getAttribute("aria-expanded")).toBe("true");

    const seventhFloor = screen
      .getByText("7 inventory.floorShort")
      .closest("details");
    expect(seventhFloor?.textContent).toContain("701");
    expect(seventhFloor?.textContent).toContain("702");
    expect(seventhFloor?.textContent).not.toContain("101");
  });
});
