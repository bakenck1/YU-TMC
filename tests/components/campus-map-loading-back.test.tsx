import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CampusMap from "@/components/CampusMap";
import { buildCampusMapData } from "@/lib/campus-map-data";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

describe("campus modal back navigation while a level is loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not close the entire modal when Back is pressed while an item is loading", () => {
    render(<CampusMap data={campusData()} />);
    fireEvent.click(screen.getByText("The Main Campus"));
    act(() => vi.advanceTimersByTime(600));

    fireEvent.click(screen.getByText("Loading-back asset"));
    expect(screen.getByText("map.loading")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "map.back" }));

    expect(screen.getByRole("button", { name: "map.back" })).not.toBeNull();
    expect(screen.getAllByText('map.floor:{"n":1}').length).toBeGreaterThan(0);
  });

  it("returns to the building instead of closing when a floor is still loading", () => {
    render(<CampusMap data={campusData()} />);
    fireEvent.click(screen.getByText("The Main Campus"));
    act(() => vi.advanceTimersByTime(600));

    fireEvent.click(screen.getByText('map.floor:{"n":1}'));
    expect(screen.getByText("map.loading")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "map.back" }));

    expect(screen.getByRole("button", { name: "map.back" })).not.toBeNull();
    expect(screen.getByText("map.floorsHeading")).not.toBeNull();
  });
});

function campusData() {
  return buildCampusMapData([{
    id: "building-1",
    name: "The Main Campus",
    address: "Campus",
    qrCode: "building-qr",
    roomCount: 1,
    status: "active",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }], [{
    id: "room-1",
    buildingId: "building-1",
    designation: "101",
    floorNumber: 1,
    floorLabel: null,
    qrCode: "room-qr",
    status: "active",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }], [item()]);
}

function item(): InventoryItemDto {
  return {
    id: "item-1",
    name: "Loading-back asset",
    description: null,
    category: "electronics",
    itemType: "electronics",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 100,
    inventoryNumberKind: "official",
    inventoryNumber: "INV-1",
    room: {
      id: "room-1",
      designation: "101",
      floorNumber: 1,
      buildingId: "building-1",
      buildingName: "The Main Campus",
    },
    status: "active",
    qrCode: null,
    responsible: { id: "user-1", name: "Employee" },
    photoUrl: null,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
  };
}
