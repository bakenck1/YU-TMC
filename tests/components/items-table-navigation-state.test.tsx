import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ItemsTable from "@/components/ItemsTable";
import { parseInventoryTableViewState } from "@/lib/inventory-list-state";
import type { InventoryItem } from "@/lib/types";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
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

const ITEMS: InventoryItem[] = Array.from({ length: 35 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: `Item ${index + 1}`,
  inventoryNumber: `INV-${index + 1}`,
  category: "electronics",
  brand: "Epson",
  model: "EB-X49",
  itemType: "Projector",
  building: "Main campus",
  room: "301",
  location: "Main campus / 301",
  responsible: "Employee",
  status: "active",
  photoColor: "#000000",
}));

describe("ItemsTable navigation state", () => {
  beforeEach(() => {
    routerPush.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items?page=3");
  });

  it("restores typed filters and page 3 after leaving an item", async () => {
    const firstRender = render(
      <ItemsTable
        items={ITEMS}
        initialViewState={parseInventoryTableViewState(
          new URLSearchParams(window.location.search),
        )}
        stateUrlPath="/items"
      />,
    );

    const search = screen.getByRole("textbox", { name: "common.search" });
    fireEvent.change(search, { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: /^items\.filters/ }));
    fireEvent.change(screen.getByLabelText("itemDetails.brand"), {
      target: { value: "Epson" },
    });
    fireEvent.click(screen.getByRole("button", { name: "items.applyFilters" }));
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));
    fireEvent.click(screen.getByRole("button", { name: "common.next" }));

    await waitFor(() => {
      expect(window.location.search).toContain("q=Item");
      expect(window.location.search).toContain("brand=Epson");
      expect(window.location.search).toContain("page=3");
    });
    expect(
      screen.getByText('items.range:{"from":21,"to":30,"total":35}'),
    ).not.toBeNull();

    const detailsLink = screen.getAllByRole("link", { name: /Item 21/ })[0];
    const detailsUrl = new URL(
      detailsLink.getAttribute("href")!,
      window.location.origin,
    );
    const returnHref = detailsUrl.searchParams.get("returnTo");
    expect(returnHref).toBe(
      "/items?q=Item&brand=Epson&page=3",
    );

    firstRender.unmount();
    window.history.replaceState({}, "", returnHref!);
    render(
      <ItemsTable
        items={ITEMS}
        initialViewState={parseInventoryTableViewState(
          new URLSearchParams(window.location.search),
        )}
        stateUrlPath="/items"
      />,
    );

    expect(
      (screen.getByRole("textbox", { name: "common.search" }) as HTMLInputElement)
        .value,
    ).toBe("Item");
    expect(
      screen.getByText('items.range:{"from":21,"to":30,"total":35}'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^items\.filters/ }));
    expect((screen.getByLabelText("itemDetails.brand") as HTMLInputElement).value)
      .toBe("Epson");

    fireEvent.click(screen.getByRole("button", { name: "items.clearFilters" }));
    await waitFor(() => {
      expect(window.location.search).toBe("?q=Item");
    });
  });

  it("offers standard page sizes and stores the selected size in the URL", async () => {
    render(
      <ItemsTable
        items={ITEMS}
        initialViewState={parseInventoryTableViewState(
          new URLSearchParams(window.location.search),
        )}
        stateUrlPath="/items"
      />,
    );

    const pageSize = screen.getByRole("combobox", {
      name: "items.recordsPerPage",
    }) as HTMLSelectElement;
    expect(Array.from(pageSize.options, (option) => option.value)).toEqual([
      "10",
      "20",
      "50",
      "100",
    ]);

    fireEvent.change(pageSize, { target: { value: "100" } });

    await waitFor(() => {
      expect(window.location.search).toBe("?pageSize=100");
    });
    expect(
      screen.getByText('items.range:{"from":1,"to":35,"total":35}'),
    ).not.toBeNull();
  });
});
