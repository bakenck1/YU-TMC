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
      roomCount: 5,
    };
    const rooms = [
      room("44444444-4444-4444-8444-444444444444", "D412", 4),
      room("55555555-5555-4555-8555-555555555555", "В404", 4),
      room("77777777-7777-4777-8777-777777777777", "401 Б", 4),
      room("88888888-8888-4888-8888-888888888888", "Мангышлак А", 4),
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
      name: /inventory\.roomsCount: 5/,
    }));

    const fourthFloorLabel = await screen.findByText("4 inventory.floorShort");
    const fourthFloor = fourthFloorLabel.closest("details");
    expect(fourthFloor?.open).toBe(false);
    fireEvent.click(fourthFloorLabel.closest("summary")!);
    expect(fourthFloor?.open).toBe(true);

    await waitFor(() => {
      expect(within(fourthFloor!).getByText("A корпус")).toBeTruthy();
      expect(within(fourthFloor!).getByText("B корпус")).toBeTruthy();
      expect(within(fourthFloor!).getByText("D корпус")).toBeTruthy();
      expect(within(fourthFloor!).getByText("E корпус")).toBeTruthy();
    });

    const dWing = within(fourthFloor!).getByText("D корпус").closest("details");
    expect(dWing?.textContent).toContain("D412");
    const bWing = within(fourthFloor!).getByText("B корпус").closest("details");
    expect(bWing?.open).toBe(false);
    const bWingSummary = bWing?.querySelector("summary");
    if (!bWingSummary) throw new Error("B wing summary is missing");
    fireEvent.click(bWingSummary);
    expect(bWing?.open).toBe(true);
    expect(bWing?.textContent).toContain("В404");
    expect(bWing?.textContent).toContain("401 Б");
    expect(bWing?.textContent).toContain("inventory.roomsCount: 2");
    const aWing = within(fourthFloor!).getByText("A корпус").closest("details");
    expect(aWing?.textContent).toContain("inventory.roomsCount: 1");
    expect(aWing?.textContent).toContain("Мангышлак А");

    const fifthFloor = screen
      .getByText("5 inventory.floorShort")
      .closest("details");
    expect(fifthFloor?.textContent).toContain("A501");
    expect(fifthFloor?.textContent).not.toContain("A корпус");
  });

  it("shows an empty K wing on the second floor of the main campus only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      rooms: [room("first-floor", "A101", 1)],
    })));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "The Main Campus", roomCount: 1 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /inventory\.roomsCount: 1/ }));
    const secondFloor = (await screen.findByText("2 inventory.floorShort")).closest("details");
    expect(within(secondFloor!).getByText("К корпус")).toBeTruthy();
    const firstFloor = screen.getByText("1 inventory.floorShort").closest("details");
    expect(within(firstFloor!).queryByText("К корпус")).toBeNull();
  });

  it.each(["К201", "k202", "203 К"])("reveals a saved %s room inside the second-floor K wing", async (designation) => {
    const createdRoom = room("created-k-room", designation, 2);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json(init?.method === "POST" ? { room: createdRoom } : { rooms: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "The Main Campus", roomCount: 0 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "inventory.addRoom" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("inventory.roomDesignation"), { target: { value: designation } });
    fireEvent.change(within(dialog).getByLabelText("inventory.floor"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const secondFloor = screen.getByText("2 inventory.floorShort").closest("details");
    const kWing = within(secondFloor!).getByText("К корпус").closest("details");
    expect(secondFloor?.open).toBe(true);
    expect(kWing?.open).toBe(true);
    expect(within(kWing!).getByText(designation)).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    fireEvent.click(kWing!.querySelector("summary")!);
    expect(kWing?.open).toBe(false);
    fireEvent.click(kWing!.querySelector("summary")!);
    expect(kWing?.open).toBe(true);
  });

  it("keeps the new K room when the initial room list arrives after saving", async () => {
    const createdRoom = room("created-k-room", "К201", 2);
    let resolveRooms: (value: Response) => void = () => {};
    const initialRooms = new Promise<Response>((resolve) => { resolveRooms = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ room: createdRoom }) : initialRooms));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "The Main Campus", roomCount: 1 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "inventory.addRoom" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("inventory.roomDesignation"), { target: { value: "К201" } });
    fireEvent.change(within(dialog).getByLabelText("inventory.floor"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await screen.findByText("К201");
    resolveRooms(Response.json({ rooms: [room("first-floor", "A101", 1)] }));
    await screen.findByText("A101");
    const kWing = screen.getByText("К корпус").closest("details");
    expect(kWing?.open).toBe(true);
    expect(within(kWing!).getByText("К201")).toBeTruthy();
  });

  it.each([
    "Факультет инжиниринга",
    "24 мкр",
    "Yessenov university — Факультет инжиниринга",
  ])("groups engineering wings for %s only after two rooms on the same floor", async (name) => {
    const rooms = [
      room("z-first", "Z103", 1),
      room("z-second", "Z104", 1),
      room("g-ten", "G10", 1),
      room("g-two", "g2", 1),
      room("g-suffix", "101 G", 1),
      room("kazakh-wing", "Ғ104", 1),
      room("kazakh-wing-second", "Ғ106", 1),
      room("unassigned-number", "105", 1),
      room("unassigned-name", "Кабинет УИТ", 1),
      room("security-first", "Охрана", 1),
      room("security-second", "Охрана", 1),
      room("corridor-first", "Коридор", 1),
      room("corridor-second", "Коридор", 1),
      room("g-fourth", "G401", 4),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rooms })));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name, roomCount: rooms.length },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /inventory\.roomsCount: 14/ }));

    const firstFloor = (await screen.findByText("1 inventory.floorShort")).closest("details")!;
    const wingLabels = [...firstFloor.querySelectorAll("details > summary > span.truncate")]
      .map((label) => label.textContent);
    expect(wingLabels).toHaveLength(3);
    expect(wingLabels.filter((label) => label === "G корпус" || label === "Z корпус"))
      .toEqual(["G корпус", "Z корпус"]);
    const gWing = within(firstFloor).getByText("G корпус").closest("details")!;
    expect(gWing.open).toBe(false);
    fireEvent.click(firstFloor.querySelector("summary")!);
    fireEvent.click(gWing.querySelector("summary")!);
    expect(gWing.open).toBe(true);
    expect(within(gWing).getByText("inventory.roomsCount: 3")).toBeTruthy();
    const roomLabels = [...gWing.querySelectorAll("p.truncate")].map((label) => label.textContent);
    expect(roomLabels).toEqual(["101 G", "g2", "G10"]);
    expect(within(firstFloor).getByText("Ғ корпус")).toBeTruthy();
    expect(within(firstFloor).getByText("105").closest("details")).toBe(firstFloor);
    expect(within(firstFloor).getByText("Кабинет УИТ").closest("details")).toBe(firstFloor);
    for (const designation of ["Охрана", "Коридор"]) {
      const labels = within(firstFloor).getAllByText(designation);
      expect(labels).toHaveLength(2);
      for (const label of labels) expect(label.closest("details")).toBe(firstFloor);
      expect(within(firstFloor).queryByText(`${designation} корпус`)).toBeNull();
    }
    expect(within(gWing).queryByText("G401")).toBeNull();
    expect(screen.queryByText("2 inventory.floorShort")).toBeNull();
    expect(screen.queryByText("A корпус")).toBeNull();
    expect(screen.queryByText("B корпус")).toBeNull();
    const fourthFloor = screen.getByText("4 inventory.floorShort").closest("details")!;
    expect(within(fourthFloor).queryByText("G корпус")).toBeNull();
    expect(within(fourthFloor).queryByText("Z корпус")).toBeNull();
    expect(within(fourthFloor).getByText("G401")).toBeTruthy();
    expect(within(fourthFloor).getByText("G401").closest("details")).toBe(fourthFloor);
    fireEvent.click(gWing.querySelector("summary")!);
    expect(gWing.open).toBe(false);
  });

  it.each([
    ["G", "G"],
    ["g202", "G"],
    ["203 G", "G"],
    ["G корпус", "G"],
    ["Ғ", "Ғ"],
  ])("reveals the second engineering room %s inside its new wing", async (designation, wing) => {
    const createdRoom = room("created-engineering-room", designation, 2);
    const existingRoom = room("existing-engineering-room", `${wing}200`, 2);
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json(init?.method === "POST" ? { room: createdRoom } : { rooms: [existingRoom] })));
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "Факультет инжиниринга", roomCount: 1 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "inventory.addRoom" }));
    await screen.findByText(existingRoom.designation);
    expect(screen.queryByText(`${wing} корпус`, { selector: "summary > span.truncate" })).toBeNull();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("inventory.roomDesignation"), { target: { value: designation } });
    fireEvent.change(within(dialog).getByLabelText("inventory.floor"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const floor = screen.getByText("2 inventory.floorShort").closest("details")!;
    const group = within(floor).getByText(`${wing} корпус`, { selector: "summary > span.truncate" }).closest("details")!;
    expect(floor.open).toBe(true);
    expect(group.open).toBe(true);
    expect(within(group).getByText(existingRoom.designation)).toBeTruthy();
    expect(within(group).getByText(designation, { selector: "p.truncate" })).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    fireEvent.click(group.querySelector("summary")!);
    expect(group.open).toBe(false);
    fireEvent.click(group.querySelector("summary")!);
    expect(group.open).toBe(true);
  });

  it("shows the saved first engineering room directly in the expanded floor", async () => {
    const createdRoom = room("created-first-engineering-room", "G101", 1);
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json(init?.method === "POST" ? { room: createdRoom } : { rooms: [] })));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "Факультет инжиниринга", roomCount: 0 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "inventory.addRoom" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("inventory.roomDesignation"), { target: { value: "G101" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    const label = await screen.findByText("G101");
    const floor = screen.getByText("1 inventory.floorShort").closest("details")!;
    expect(floor.open).toBe(true);
    expect(label.closest("details")).toBe(floor);
    expect(screen.queryByText("G корпус")).toBeNull();
  });

  it("reveals the second engineering room when the initial room list arrives after saving", async () => {
    const createdRoom = room("created-engineering-room", "G201", 2);
    let resolveRooms: (value: Response) => void = () => {};
    const initialRooms = new Promise<Response>((resolve) => { resolveRooms = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ room: createdRoom }) : initialRooms));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "Факультет инжиниринга", roomCount: 1 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "inventory.addRoom" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("inventory.roomDesignation"), { target: { value: "G201" } });
    fireEvent.change(within(dialog).getByLabelText("inventory.floor"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await screen.findByText("G201");
    expect(screen.queryByText("G корпус")).toBeNull();
    resolveRooms(Response.json({ rooms: [room("first-floor", "H101", 1), room("existing-g-room", "G202", 2)] }));
    await screen.findByText("H101");
    const group = screen.getByText("G корпус").closest("details")!;
    expect(group.open).toBe(true);
    expect(group.parentElement?.closest("details")?.open).toBe(true);
    expect(within(group).getAllByText("G201")).toHaveLength(1);
    expect(within(group).getByText("G202")).toBeTruthy();
    expect(within(group).queryByText("H101")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returns the remaining engineering room to its floor after archiving the second room", async () => {
    const firstRoom = room("remaining-g-room", "G101", 1);
    const archivedRoom = room("archived-g-room", "G102", 1);
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json(init?.method === "DELETE" ? {} : { rooms: [firstRoom, archivedRoom] })));
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, name: "Факультет инжиниринга", roomCount: 2 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /inventory\.roomsCount: 2/ }));
    const archivedLabel = await screen.findByText("G102");
    const floor = screen.getByText("1 inventory.floorShort").closest("details")!;
    fireEvent.click(floor.querySelector("summary")!);
    const group = within(floor).getByText("G корпус").closest("details")!;
    fireEvent.click(group.querySelector("summary")!);
    const card = archivedLabel.closest<HTMLDivElement>("div.rounded-xl")!;
    fireEvent.click(within(card).getByRole("button", { name: "building.archiveRoom" }));
    await waitFor(() => expect(screen.queryByText("G102")).toBeNull());
    expect(within(floor).queryByText("G корпус")).toBeNull();
    expect(within(floor).getByText("G101").closest("details")).toBe(floor);
    expect(floor.open).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps lettered rooms flat for buildings without engineering wing navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rooms: [room("other-g", "G101", 1)] })));
    render(<InventoryBuildingsManager actorRole="admin" initialBuildings={[
      { ...BUILDING, roomCount: 1 },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: /inventory\.roomsCount: 1/ }));
    const label = await screen.findByText("G101");
    const floor = screen.getByText("1 inventory.floorShort").closest("details");
    expect(label.closest("details")).toBe(floor);
    expect(screen.queryByText("G корпус")).toBeNull();
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
