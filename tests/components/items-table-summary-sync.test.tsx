import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ItemsTable from "@/components/ItemsTable";
import type { InventoryItem } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/items",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    locale: "en-US",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/InventoryExportButton", () => ({ default: () => null }));
vi.mock("@/components/InventoryInvoiceActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCreateForm", () => ({ default: () => null }));
vi.mock("@/components/TmcBulkActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryThumbnail", () => ({ default: () => null }));
vi.mock("@/components/InventoryVisibleStatus", () => ({ default: () => null }));

const ITEMS: InventoryItem[] = [
  item("active", "Alpha projector", "active", 2, 100, "Alex Kim"),
  item("maintenance", "Beta laptop", "maintenance", 3, 50, "Bob Lee"),
  item("written-off", "Gamma chair", "decommissioned", 4, 10, "Alex Kim"),
];

describe("ItemsTable summary synchronization", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it("keeps draft filters inert, then applies the same selection to rows, cards, and expanded card lists", () => {
    render(<ItemsTable items={ITEMS} showSummary />);

    expect(screen.getByText("9 common.unitShort")).not.toBeNull();
    expect(screen.getByText("390 common.currency")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^items\.filters/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "items.responsible" }), {
      target: { value: "Alex Kim" },
    });

    // A filter is only a draft until Apply is pressed.
    expect(screen.getByText("9 common.unitShort")).not.toBeNull();
    expect(screen.queryAllByText("Beta laptop").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "items.applyFilters" }));

    expect(screen.getByText("6 common.unitShort")).not.toBeNull();
    expect(screen.getByText("240 common.currency")).not.toBeNull();
    expect(screen.queryAllByText("Beta laptop")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /items\.summaryDecommissioned/ }));
    expect(screen.queryAllByText("Gamma chair").length).toBeGreaterThan(1);
    expect(screen.queryAllByText("Beta laptop")).toHaveLength(0);
  });

  it("updates both rows and all four cards immediately from the search string", () => {
    render(<ItemsTable items={ITEMS} showSummary />);

    fireEvent.change(screen.getByRole("textbox", { name: "common.search" }), {
      target: { value: "Beta" },
    });

    expect(screen.getAllByText("3 common.unitShort").length).toBeGreaterThan(0);
    expect(screen.getByText("150 common.currency")).not.toBeNull();
    expect(screen.queryAllByText("Alpha projector")).toHaveLength(0);
    expect(screen.queryAllByText("Gamma chair")).toHaveLength(0);
    expect(screen.queryAllByText("Beta laptop").length).toBeGreaterThan(0);
  });
});

function item(
  id: string,
  name: string,
  status: InventoryItem["status"],
  quantity: number,
  price: number,
  responsible: string,
): InventoryItem {
  return {
    id,
    name,
    inventoryNumber: `INV-${id}`,
    category: "electronics",
    location: "Main / 1 floor / 101",
    building: "Main",
    room: "101",
    floorNumber: 1,
    responsible,
    status,
    photoColor: "#000",
    quantity,
    price,
  };
}
