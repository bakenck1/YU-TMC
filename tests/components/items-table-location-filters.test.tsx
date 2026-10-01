import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ItemsTable from "@/components/ItemsTable";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type { InventoryItem } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    t: (key: string, values?: Record<string, unknown>) =>
      key === "inventory.floorShort"
        ? "floor"
        : values
          ? `${key}:${JSON.stringify(values)}`
          : key,
  }),
}));
vi.mock("@/components/InventoryExportButton", () => ({ default: () => null }));
vi.mock("@/components/InventoryInvoiceActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCreateForm", () => ({ default: () => null }));
vi.mock("@/components/TmcBulkActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryThumbnail", () => ({ default: () => null }));
vi.mock("@/components/InventoryVisibleStatus", () => ({ default: () => null }));

const BUILDINGS: BuildingDto[] = [
  building("building-main", "Main Campus"),
  building("building-annex", "Main Campus Annex"),
  building("building-empty", "Tech Park"),
];

const ROOMS: RoomDto[] = [
  room("room-main-101", "building-main", "101", 1),
  room("room-main-1010", "building-main", "1010", 1),
  room("room-main-201", "building-main", "201", 2),
  room("room-annex-a201", "building-annex", "A201", 2),
  room("room-annex-1101", "building-annex", "1101", 11),
  // This location deliberately has no inventory yet. A static location picker
  // must still expose data from the location registry, not only from the rows.
  room("room-empty-404", "building-empty", "404", 4),
];

const ITEMS: InventoryItem[] = [
  item("main-101", "Main 101", "building-main", "Main Campus", "room-main-101", "101", 1),
  item("main-1010", "Main 1010", "building-main", "Main Campus", "room-main-1010", "1010", 1),
  item("main-201", "Main 201", "building-main", "Main Campus", "room-main-201", "201", 2),
  item("annex-a201", "Annex A201", "building-annex", "Main Campus Annex", "room-annex-a201", "A201", 2),
  item("annex-1101", "Annex 1101", "building-annex", "Main Campus Annex", "room-annex-1101", "1101", 11),
];

describe("ItemsTable adversarial location filters", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it.each([
    ["К201", "К201"], ["к201", "К201"], ["K201", "К201"], ["k201", "К201"],
    ["К201", "K201"], ["к201", "K201"],
  ])("finds a K room suggestion and its inventory using %s for %s", (query, designation) => {
    render(<ItemsTable
      items={[
        item("k-room", "K room inventory", "building-main", "Main Campus", "room-k", designation, 2),
        item("k-room-long", "Other K room", "building-main", "Main Campus", "room-k-long", `${designation}0`, 2),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [room("room-k", "building-main", designation, 2)] }}
    />);
    openFilters();
    const roomFilter = screen.getByRole("combobox", { name: "items.filterRoom" });
    fireEvent.focus(roomFilter);
    fireEvent.change(roomFilter, { target: { value: query } });
    expect(screen.getByRole("option", { name: designation })).not.toBeNull();
    applyFilters();
    expectVisible("K room inventory");
    expectHidden("Other K room");
  });

  it("shows the complete static building registry before the user types and then searches it", () => {
    renderTable();
    openFilters();

    const buildingFilter = screen.getByRole("combobox", {
      name: "items.filterBuilding",
    });
    fireEvent.focus(buildingFilter);

    expect(screen.getByRole("option", { name: "Main Campus" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Main Campus Annex" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Tech Park" })).not.toBeNull();

    fireEvent.change(buildingFilter, { target: { value: "tech" } });
    expect(screen.getByRole("option", { name: "Tech Park" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Main Campus" })).toBeNull();
  });

  it("lets the user select a floor without selecting a building and matches the exact floor", () => {
    renderTable();
    openFilters();

    choose("items.filterFloor", "1 floor");
    applyFilters();

    expectVisible("Main 101");
    expectVisible("Main 1010");
    expectHidden("Main 201");
    expectHidden("Annex A201");
    expectHidden("Annex 1101");
  });

  it("lets the user select a room immediately without a building or floor", () => {
    renderTable();
    openFilters();

    choose("items.filterRoom", "A201");
    applyFilters();

    expectVisible("Annex A201");
    expectHidden("Main 201");
    expectHidden("Main 101");
  });

  it("treats a selected room as an exact cabinet rather than a substring", () => {
    renderTable();
    openFilters();

    choose("items.filterRoom", "101");
    applyFilters();

    expectVisible("Main 101");
    expectHidden("Main 1010");
  });

  it("cascades floor and room choices through the selected building", () => {
    renderTable();
    openFilters();

    choose("items.filterBuilding", "Main Campus");

    const floorFilter = screen.getByRole("combobox", { name: "items.filterFloor" });
    fireEvent.focus(floorFilter);
    expect(screen.getByRole("option", { name: "1 floor" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "2 floor" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "11 floor" })).toBeNull();
    expect(screen.queryByRole("option", { name: "4 floor" })).toBeNull();

    choose("items.filterFloor", "2 floor");
    const roomFilter = screen.getByRole("combobox", { name: "items.filterRoom" });
    fireEvent.focus(roomFilter);
    expect(screen.getByRole("option", { name: "201" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "101" })).toBeNull();
    expect(screen.queryByRole("option", { name: "A201" })).toBeNull();
  });

  it("does not retain an impossible floor and room after the building changes", () => {
    renderTable();
    openFilters();

    choose("items.filterBuilding", "Main Campus");
    choose("items.filterFloor", "1 floor");
    choose("items.filterRoom", "101");
    choose("items.filterBuilding", "Main Campus Annex");

    expect(inputValue("items.filterFloor")).toBe("");
    expect(inputValue("items.filterRoom")).toBe("");
    applyFilters();

    expectVisible("Annex A201");
    expectVisible("Annex 1101");
    expectHidden("Main 101");
    expectHidden("Main 201");
  });

  it("matches a selected building exactly instead of leaking prefix-named buildings", () => {
    renderTable();
    openFilters();

    choose("items.filterBuilding", "Main Campus");
    applyFilters();

    expectVisible("Main 101");
    expectVisible("Main 201");
    expectHidden("Annex A201");
    expectHidden("Annex 1101");
  });
});

describe("ItemsTable inventory search suggestions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it("offers unique inventory names on focus with no typing or search history, including later pages", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      ...ITEMS[0],
      id: `item-${index}`,
      name: `Моноблок ${index + 1}`,
    }));
    renderTable([...items, { ...items[0], id: "duplicate", name: "  МОНОБЛОК  1  " }]);

    expect(screen.queryAllByText("Моноблок 12")).toHaveLength(0);
    fireEvent.focus(searchInput());

    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(12);
    expect(screen.getByRole("option", { name: "Моноблок 12" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Моноблок 1" })).not.toBeNull();
  });

  it("offers only names from the applied room and refreshes them when the room changes", () => {
    renderTable();
    openFilters();
    choose("items.filterRoom", "101");
    applyFilters();
    fireEvent.focus(searchInput());

    expect(screen.getByRole("option", { name: "Main 101" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Main 1010" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Annex A201" })).toBeNull();

    fireEvent.keyDown(searchInput(), { key: "Escape" });
    openFilters();
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), {
      target: { value: "" },
    });
    choose("items.filterRoom", "A201");
    applyFilters();
    fireEvent.focus(searchInput());

    expect(screen.getByRole("option", { name: "Annex A201" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Main 101" })).toBeNull();
  });

  it("uses all applied filters, while a draft room does not change suggestions", () => {
    renderTable([
      { ...ITEMS[0], name: "Моноблок", category: "electronics" },
      { ...ITEMS[1], name: "Стол", category: "furniture" },
    ]);
    openFilters();
    choose("items.filterRoom", "1010");
    fireEvent.focus(searchInput());
    expect(screen.getByRole("option", { name: "Моноблок" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Стол" })).not.toBeNull();

    fireEvent.keyDown(searchInput(), { key: "Escape" });
    fireEvent.change(screen.getByRole("combobox", { name: "items.type" }), {
      target: { value: "electronics" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), {
      target: { value: "" },
    });
    applyFilters();
    fireEvent.focus(searchInput());
    expect(screen.getByRole("option", { name: "Моноблок" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Стол" })).toBeNull();
  });

  it("selects a name by mouse, filters the rows, and returns to page one", () => {
    renderTable(Array.from({ length: 12 }, (_, index) => ({
      ...ITEMS[0], id: `item-${index}`, name: `Equipment ${index + 1}`,
    })));
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));
    fireEvent.focus(searchInput());
    fireEvent.click(screen.getByRole("option", { name: "Equipment 12" }));

    expect(searchInput().value).toBe("Equipment 12");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText('items.range:{"from":1,"to":1,"total":1}')).not.toBeNull();
    expect(screen.getAllByRole("link").every((link) => link.textContent === "Equipment 12")).toBe(true);
  });

  it("narrows suggestions as the user types and selects with arrows and Enter", () => {
    renderTable([
      { ...ITEMS[0], name: "Моноблок" },
      { ...ITEMS[1], name: "Принтер" },
    ]);
    fireEvent.focus(searchInput());
    fireEvent.change(searchInput(), { target: { value: "  МОНО  " } });
    expect(screen.getByRole("option", { name: "Моноблок" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Принтер" })).toBeNull();
    fireEvent.keyDown(searchInput(), { key: "ArrowDown" });
    const selectedOption = screen.getByRole("option", { name: "Моноблок", selected: true });
    expect(searchInput().getAttribute("aria-activedescendant")).toBe(selectedOption.id);
    fireEvent.keyDown(searchInput(), { key: "Enter" });

    expect(searchInput().value).toBe("Моноблок");
    expect(screen.queryByRole("listbox")).toBeNull();
    expectHidden("Принтер");
    fireEvent.click(searchInput());
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(searchInput(), { key: "Escape" });
    expect(searchInput().getAttribute("aria-expanded")).toBe("false");
  });

  it("excludes history from other rooms and avoids duplicating names in history", async () => {
    window.localStorage.setItem(
      "yu-inventory:item-search-history:v1:test",
      JSON.stringify(["Main 101", "Annex A201", "INV-main-101", "INV-annex-a201"]),
    );
    render(<ItemsTable items={ITEMS} searchHistoryScope="test" />);
    openFilters();
    choose("items.filterRoom", "101");
    applyFilters();
    fireEvent.focus(searchInput());

    await waitFor(() => expect(screen.getByRole("option", { name: "INV-main-101" })).not.toBeNull());
    expect(screen.getAllByRole("option", { name: "Main 101" })).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "Annex A201" })).toBeNull();
    expect(screen.queryByRole("option", { name: "INV-annex-a201" })).toBeNull();
  });

  it("does not offer inventory from elsewhere for an empty room", () => {
    renderTable();
    openFilters();
    choose("items.filterBuilding", "Tech Park");
    choose("items.filterRoom", "404");
    applyFilters();
    fireEvent.focus(searchInput());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(searchInput().getAttribute("aria-expanded")).toBe("false");
  });
});

function searchInput() {
  return screen.getByRole("combobox", { name: "common.search" }) as HTMLInputElement;
}

function renderTable(items = ITEMS) {
  return render(
    <ItemsTable
      items={items}
      locations={{ buildings: BUILDINGS, rooms: ROOMS }}
    />,
  );
}

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: /^items\.filters/ }));
}

function choose(label: string, option: string) {
  const input = screen.getByRole("combobox", { name: label });
  fireEvent.focus(input);
  fireEvent.click(screen.getByRole("option", { name: option }));
}

function applyFilters() {
  fireEvent.click(screen.getByRole("button", { name: "items.applyFilters" }));
}

function inputValue(label: string) {
  return (screen.getByRole("combobox", { name: label }) as HTMLInputElement).value;
}

function expectVisible(name: string) {
  expect(screen.queryAllByText(name).length).toBeGreaterThan(0);
}

function expectHidden(name: string) {
  expect(screen.queryAllByText(name)).toHaveLength(0);
}

function building(id: string, name: string): BuildingDto {
  return {
    id,
    name,
    address: `${name} address`,
    qrCode: `building:${id}`,
    roomCount: 0,
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function room(
  id: string,
  buildingId: string,
  designation: string,
  floorNumber: number,
): RoomDto {
  return {
    id,
    buildingId,
    designation,
    floorNumber,
    floorLabel: null,
    qrCode: `room:${id}`,
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function item(
  id: string,
  name: string,
  buildingId: string,
  buildingName: string,
  roomId: string,
  roomDesignation: string,
  floorNumber: number,
): InventoryItem {
  return {
    id,
    name,
    inventoryNumber: `INV-${id}`,
    category: "electronics",
    buildingId,
    building: buildingName,
    roomId,
    room: roomDesignation,
    floorNumber,
    location: `${buildingName} / ${floorNumber} floor / ${roomDesignation}`,
    responsible: "Employee",
    status: "active",
    photoColor: "#000000",
  };
}
