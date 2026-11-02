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

const LOOKALIKE_ROOM_LETTERS = [
  ["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"],
  ["Н", "H"], ["О", "O"], ["Р", "P"], ["С", "C"], ["Т", "T"],
  ["У", "Y"], ["Х", "X"], ["І", "I"],
] as const;

const LOOKALIKE_ROOM_QUERIES = LOOKALIKE_ROOM_LETTERS.flatMap(([cyrillic, latin]) => [
  [`${cyrillic}201`, `${latin}201`, `${cyrillic}2010`],
  [`${cyrillic.toLocaleLowerCase()}201`, `${latin}201`, `${cyrillic}2010`],
  [`${latin}201`, `${cyrillic}201`, `${latin}2010`],
  [`${latin.toLocaleLowerCase()}201`, `${cyrillic}201`, `${latin}2010`],
]);

describe("ItemsTable adversarial location filters", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it.each([
    ...LOOKALIKE_ROOM_QUERIES,
    ["аBе201", "AВE201", "АBЕ2010"],
    ["AВe201", "АBЕ201", "AВE2010"],
  ])("finds an exact room suggestion and inventory using %s for %s", (query, designation, longerDesignation) => {
    render(<ItemsTable
      items={[
        item("matched-room", "Matching room inventory", "building-main", "Main Campus", "room-match", designation, 2),
        item("longer-room", "Longer room inventory", "building-main", "Main Campus", "room-longer", longerDesignation, 2),
        item("annex-room", "Other building inventory", "building-annex", "Main Campus Annex", "room-annex", designation, 2),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [
        room("room-match", "building-main", designation, 2),
        room("room-longer", "building-main", longerDesignation, 2),
        room("room-annex", "building-annex", designation, 2),
        room("room-annex-only", "building-annex", `${designation}9`, 2),
      ] }}
    />);
    openFilters();
    choose("items.filterBuilding", "Main Campus");
    const roomFilter = screen.getByRole("combobox", { name: "items.filterRoom" });
    fireEvent.focus(roomFilter);
    fireEvent.change(roomFilter, { target: { value: query } });
    expect(screen.getByRole("option", { name: designation })).not.toBeNull();
    expect(screen.queryByRole("option", { name: `${designation}9` })).toBeNull();
    applyFilters();
    expectVisible("Matching room inventory");
    expectHidden("Longer room inventory");
    expectHidden("Other building inventory");
  });

  it.each(["Е", "е", "E", "e"])("finds both room alphabets using the single-letter query %s within the chosen building", (query) => {
    render(<ItemsTable
      items={[
        item("latin-e", "Latin E inventory", "building-main", "Main Campus", "room-latin-e", "E201", 2),
        item("cyrillic-e", "Cyrillic E inventory", "building-main", "Main Campus", "room-cyrillic-e", "Е202", 2),
        item("f-room", "Different letter inventory", "building-main", "Main Campus", "room-f", "F204", 2),
        item("annex-e", "Annex E inventory", "building-annex", "Main Campus Annex", "room-annex-e", "Е203", 2),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [
        room("room-latin-e", "building-main", "E201", 2),
        room("room-cyrillic-e", "building-main", "Е202", 2),
        room("room-f", "building-main", "F204", 2),
        room("room-annex-e", "building-annex", "Е203", 2),
      ] }}
    />);
    openFilters();
    choose("items.filterBuilding", "Main Campus");
    const roomFilter = screen.getByRole("combobox", { name: "items.filterRoom" });
    fireEvent.focus(roomFilter);
    fireEvent.change(roomFilter, { target: { value: query } });
    expect(screen.getByRole("option", { name: "E201" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Е202" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Е203" })).toBeNull();
    expect(screen.queryByRole("option", { name: "F204" })).toBeNull();
    applyFilters();
    expectVisible("Latin E inventory");
    expectVisible("Cyrillic E inventory");
    expectHidden("Different letter inventory");
    expectHidden("Annex E inventory");
  });

  it.each([
    ["R201", "Р201"], ["Р201", "R201"],
    ["V201", "В201"], ["В201", "V201"],
  ])("does not apply phonetic transliteration from %s to %s", (query, designation) => {
    render(<ItemsTable
      items={[item("phonetic-room", "Phonetic room inventory", "building-main", "Main Campus", "room-phonetic", designation, 2)]}
      locations={{ buildings: BUILDINGS, rooms: [room("room-phonetic", "building-main", designation, 2)] }}
    />);
    openFilters();
    const roomFilter = screen.getByRole("combobox", { name: "items.filterRoom" });
    fireEvent.focus(roomFilter);
    fireEvent.change(roomFilter, { target: { value: query } });
    expect(screen.queryByRole("option", { name: designation })).toBeNull();
    applyFilters();
    expectHidden("Phonetic room inventory");
  });

  it.each(LOOKALIKE_ROOM_LETTERS)("preserves a typed %s room when building and floor choices contain Latin %s", (cyrillic, latin) => {
    const designation = `${latin}201`;
    const query = `${cyrillic.toLocaleLowerCase()}201`;
    render(<ItemsTable
      items={[
        item("main-room", "Main matching inventory", "building-main", "Main Campus", "room-main", designation, 2),
        item("annex-room", "Annex matching inventory", "building-annex", "Main Campus Annex", "room-annex", designation, 2),
        item("annex-other-floor", "Other floor inventory", "building-annex", "Main Campus Annex", "room-other-floor", `${latin}301`, 3),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [
        room("room-main", "building-main", designation, 2),
        room("room-annex", "building-annex", designation, 2),
        room("room-other-floor", "building-annex", `${latin}301`, 3),
      ] }}
    />);
    openFilters();
    choose("items.filterBuilding", "Main Campus");
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), { target: { value: query } });
    choose("items.filterBuilding", "Main Campus Annex");
    expect(inputValue("items.filterRoom")).toBe(query);
    choose("items.filterFloor", "2 floor");
    expect(inputValue("items.filterRoom")).toBe(query);
    applyFilters();
    expectVisible("Annex matching inventory");
    expectHidden("Main matching inventory");
    expectHidden("Other floor inventory");
  });

  it("preserves a partial Cyrillic room query when choosing a compatible building and floor", () => {
    render(<ItemsTable
      items={[
        item("latin-e", "Latin E inventory", "building-main", "Main Campus", "room-latin-e", "E201", 2),
        item("cyrillic-e", "Cyrillic E inventory", "building-main", "Main Campus", "room-cyrillic-e", "Е202", 2),
        item("main-third", "Other floor inventory", "building-main", "Main Campus", "room-main-third", "E301", 3),
        item("annex-e", "Annex E inventory", "building-annex", "Main Campus Annex", "room-annex-e", "Е203", 2),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [
        room("room-latin-e", "building-main", "E201", 2),
        room("room-cyrillic-e", "building-main", "Е202", 2),
        room("room-main-third", "building-main", "E301", 3),
        room("room-annex-e", "building-annex", "Е203", 2),
      ] }}
    />);
    openFilters();
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), { target: { value: "Е" } });
    choose("items.filterBuilding", "Main Campus");
    expect(inputValue("items.filterRoom")).toBe("Е");
    choose("items.filterFloor", "2 floor");
    expect(inputValue("items.filterRoom")).toBe("Е");
    applyFilters();
    expectVisible("Latin E inventory");
    expectVisible("Cyrillic E inventory");
    expectHidden("Other floor inventory");
    expectHidden("Annex E inventory");
  });

  it("clears a partial Cyrillic room query when choosing an incompatible building or floor", () => {
    render(<ItemsTable
      items={[
        item("main-e", "Main E inventory", "building-main", "Main Campus", "room-main-e", "E201", 2),
        item("main-f", "Main F inventory", "building-main", "Main Campus", "room-main-f", "F301", 3),
        item("annex-f", "Annex F inventory", "building-annex", "Main Campus Annex", "room-annex-f", "F202", 2),
      ]}
      locations={{ buildings: BUILDINGS, rooms: [
        room("room-main-e", "building-main", "E201", 2),
        room("room-main-f", "building-main", "F301", 3),
        room("room-annex-f", "building-annex", "F202", 2),
      ] }}
    />);
    openFilters();
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), { target: { value: "Е" } });
    choose("items.filterBuilding", "Main Campus Annex");
    expect(inputValue("items.filterRoom")).toBe("");
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterBuilding" }), { target: { value: "" } });
    choose("items.filterBuilding", "Main Campus");
    fireEvent.change(screen.getByRole("combobox", { name: "items.filterRoom" }), { target: { value: "Е" } });
    choose("items.filterFloor", "3 floor");
    expect(inputValue("items.filterRoom")).toBe("");
    applyFilters();
    expectVisible("Main F inventory");
    expectHidden("Main E inventory");
    expectHidden("Annex F inventory");
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

  it("offers one name and keeps all matching items across pages after selection", () => {
    const monoblocks = Array.from({ length: 23 }, (_, index) => ({
      ...ITEMS[0], id: `monoblock-${index}`, inventoryNumber: `INV-${index}`,
      name: index % 2 === 0 ? "Моноблок" : "  МОНОБЛОК  ",
    }));
    renderTable([...monoblocks, { ...ITEMS[0], id: "printer", name: "Принтер" }]);
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));
    fireEvent.focus(searchInput());
    expect(screen.getAllByRole("option", { name: /^Моноблок$/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Моноблок" }));
    expect(screen.getByText('items.range:{"from":1,"to":10,"total":23}')).not.toBeNull();
    expectHidden("Принтер");
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));
    expect(screen.getByText('items.range:{"from":21,"to":23,"total":23}')).not.toBeNull();
    expect(new Set(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).size).toBe(3);
  });

  it("finds both Excel inventory numbers and published 1C barcodes through the same search input", () => {
    renderTable([
      { ...ITEMS[0], id: "excel", name: "Excel equipment", inventoryNumber: "0000123456" },
      { ...ITEMS[1], id: "one-c", name: "1C equipment", inventoryNumber: "OS-987", searchIdentifiers: ["0000654321", "1C-000987"] },
    ]);
    for (const query of ["0000654321", "*0000654321*", "1C-000987"]) {
      fireEvent.change(searchInput(), { target: { value: query } });
      expectVisible("1C equipment");
      expectHidden("Excel equipment");
    }
    fireEvent.change(searchInput(), { target: { value: "0000123456" } });
    expectVisible("Excel equipment");
    expectHidden("1C equipment");
  });

  it("does not repeat history entries differing only in Unicode or whitespace", async () => {
    window.localStorage.setItem("yu-inventory:item-search-history:v1:test",
      JSON.stringify([" INV-main-101 ", "ＩＮＶ-main-101", "Main 101", "MAIN  101"]));
    render(<ItemsTable items={ITEMS} searchHistoryScope="test" />);
    fireEvent.focus(searchInput());
    await waitFor(() => expect(screen.getByRole("option", { name: "INV-main-101" })).not.toBeNull());
    expect(screen.getAllByRole("option", { name: "Main 101" })).toHaveLength(1);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(6);
  });

  it("offers a published 1C name once and finds every linked item using that name", () => {
    renderTable([
      { ...ITEMS[0], id: "excel-linked", name: "Excel equipment", searchNames: ["Моноблок Lenovo", " МОНОБЛОК  Lenovo "] },
      { ...ITEMS[1], id: "one-c-linked", name: "1C equipment", searchNames: ["Моноблок\u00a0Lenovo"] },
      { ...ITEMS[2], id: "printer", name: "Принтер" },
    ]);
    fireEvent.focus(searchInput());
    expect(screen.getAllByRole("option", { name: "Моноблок Lenovo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Моноблок Lenovo" }));
    expectVisible("Excel equipment");
    expectVisible("1C equipment");
    expectHidden("Принтер");
    expect(screen.getByText('items.range:{"from":1,"to":2,"total":2}')).not.toBeNull();
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
