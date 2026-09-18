import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    t: (key: string, values?: Record<string, string>) =>
      key === "building.wingName" ? `${values?.name} корпус` : key,
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

  it("shows A, B, D and E wing filters on floors zero through four of the main campus", async () => {
    const mainCampus = {
      ...BUILDING,
      name: "The Main Campus",
      roomCount: 4,
    };
    const rooms = [
      room("44444444-4444-4444-8444-444444444444", "D412", 4),
      room("55555555-5555-4555-8555-555555555555", "В404", 4),
      room("77777777-7777-4777-8777-777777777777", "401 Б", 4),
      room("66666666-6666-4666-8666-666666666666", "A501", 5),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rooms })));

    render(
      <InventoryBuildingsManager
        actorRole="admin"
        initialBuildings={[mainCampus]}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: /inventory\.roomsCount: 4/,
    }));

    const fourthFloorLabel = await screen.findByText("4 inventory.floorShort");
    const fourthFloor = fourthFloorLabel.closest("details");
    expect(fourthFloor?.open).toBe(false);
    fireEvent.click(fourthFloorLabel.closest("summary")!);
    expect(fourthFloor?.open).toBe(true);

    await waitFor(() => {
      expect(screen.getByText("A корпус")).toBeTruthy();
      expect(screen.getByText("B корпус")).toBeTruthy();
      expect(screen.getByText("D корпус")).toBeTruthy();
      expect(screen.getByText("E корпус")).toBeTruthy();
    });

    const dWing = screen.getByText("D корпус").closest("details");
    expect(dWing?.textContent).toContain("D412");
    const bWing = screen.getByText("B корпус").closest("details");
    expect(bWing?.open).toBe(false);
    const bWingSummary = bWing?.querySelector("summary");
    if (!bWingSummary) throw new Error("B wing summary is missing");
    fireEvent.click(bWingSummary);
    expect(bWing?.open).toBe(true);
    expect(bWing?.textContent).toContain("В404");
    expect(bWing?.textContent).toContain("401 Б");
    expect(bWing?.textContent).toContain("inventory.roomsCount: 2");
    expect(screen.getByText("A корпус").closest("details")?.textContent)
      .toContain("inventory.roomsCount: 0");

    const fifthFloor = screen
      .getByText("5 inventory.floorShort")
      .closest("details");
    expect(fifthFloor?.textContent).toContain("A501");
    expect(fifthFloor?.textContent).not.toContain("A корпус");
  });

  it("lets an administrator change one room and then bulk-change an explicit selection", async () => {
    const initial = { ...room("22222222-2222-4222-8222-222222222222", "101", 1), accessMode: "open" as const };
    const closed = { ...initial, accessMode: "closed" as const, version: 2 };
    const opened = { ...initial, accessMode: "open" as const, version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ rooms: [initial] }))
      .mockResolvedValueOnce(Response.json({ room: closed }))
      .mockResolvedValueOnce(Response.json({
        results: [{ id: opened.id, status: "updated", room: opened }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(
      <InventoryBuildingsManager
        actorRole="admin"
        initialBuildings={[{ ...BUILDING, roomCount: 1 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /inventory\.roomsCount: 1/ }));
    const roomLabel = await screen.findByText("101");
    const roomCard = roomLabel.closest<HTMLDivElement>("div.rounded-xl");
    if (!roomCard) throw new Error("room card missing");

    fireEvent.click(within(roomCard).getByRole("button", { name: "room.closeAccessAction" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      accessMode: "closed",
      version: 1,
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "room.selectForPrint: 101" }));
    fireEvent.click(screen.getByRole("button", { name: "room.openAccessAction (1)" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      accessMode: "open",
      rooms: [{ id: initial.id, version: 2 }],
    });
  });
});
