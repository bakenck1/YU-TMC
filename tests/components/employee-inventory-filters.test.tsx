import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EmployeeItemsTabs from "@/components/EmployeeItemsTabs";
import { parseInventoryTableViewState } from "@/lib/inventory-list-state";
import type { InventoryItem } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/items", useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ locale: "en-US", dataLabel: (value: string) => value, t: (key: string) => key }),
}));
vi.mock("@/components/InventoryExportButton", () => ({ default: () => null }));
vi.mock("@/components/InventoryInvoiceActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCreateForm", () => ({ default: () => null }));
vi.mock("@/components/TmcBulkActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryThumbnail", () => ({ default: () => null }));
vi.mock("@/components/InventoryVisibleStatus", () => ({ default: () => null }));

const ITEMS: InventoryItem[] = ["active", "maintenance", "broken", "decommissioned", "decommissioned_in_use"].map((status, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `Assigned ${status}`, inventoryNumber: `INV-${status}`,
  category: "electronics", location: "Main / 101", responsible: "Employee",
  status: status as InventoryItem["status"], photoColor: "#000", quantity: 1, price: 10,
}));
const PROPS = {
  items: ITEMS, searchHistoryScope: "employee", columnSettingsScope: "employee",
  actorUserId: "employee-1", actorRole: "employee" as const,
};

function applyStatus(status: string) {
  fireEvent.click(screen.getByRole("button", { name: /^items\.filters/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "items.status" }), { target: { value: status } });
  fireEvent.click(screen.getByRole("button", { name: "items.applyFilters" }));
}

describe("employee inventory without status tabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it("shows all assigned statuses and filters and clears them in the shared filter panel", async () => {
    render(<EmployeeItemsTabs {...PROPS} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    for (const item of ITEMS) expect(screen.getAllByText(item.name).length).toBeGreaterThan(0);
    for (const selected of ["maintenance", "broken", "decommissioned", "decommissioned_in_use"]) {
      applyStatus(`lifecycle:${selected}`);
      for (const item of ITEMS) {
        expect(screen.queryAllByText(item.name).length > 0).toBe(item.status === selected);
      }
      await waitFor(() => expect(new URLSearchParams(window.location.search).get("status")).toBe(`lifecycle:${selected}`));
    }
    applyStatus("all");
    for (const item of ITEMS) expect(screen.getAllByText(item.name).length).toBeGreaterThan(0);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("restores the filter after returning from details", () => {
    window.history.replaceState({}, "", "/items?status=lifecycle%3Abroken");
    render(<EmployeeItemsTabs {...PROPS} initialViewState={parseInventoryTableViewState(new URLSearchParams(window.location.search))} />);
    expect(screen.getAllByText("Assigned broken").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Assigned active")).toHaveLength(0);
  });

});
