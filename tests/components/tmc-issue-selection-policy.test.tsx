import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ItemsTable from "@/components/ItemsTable";
import type { InventoryItem } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    t: (key: string, values?: Record<string, unknown>) =>
      key === "items.selectOne" ? `select:${String(values?.name)}` : key,
  }),
}));
vi.mock("@/components/InventoryExportButton", () => ({ default: () => null }));
vi.mock("@/components/InventoryInvoiceActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCreateForm", () => ({ default: () => null }));
vi.mock("@/components/TmcBulkActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryThumbnail", () => ({
  default: ({ photo }: { photo?: string }) => <span>{photo ? "real-photo" : "photo-placeholder"}</span>,
}));
vi.mock("@/components/InventoryVisibleStatus", () => ({
  default: ({ status }: { status: unknown }) => (
    <span>{typeof status === "string" ? status : "visible-status"}</span>
  ),
}));

const ITEMS: InventoryItem[] = ([
  ["Active item", "active"],
  ["Service item", "maintenance"],
  ["Final write-off", "decommissioned"],
  ["Write-off in use", "decommissioned_in_use"],
] as const).map(([name, status], index) => ({
  id: `item-${index}`,
  name,
  inventoryNumber: `INV-${index}`,
  category: "electronics",
  building: "The Main Campus",
  room: "101",
  floorNumber: 1,
  location: "The Main Campus / 1 floor / 101",
  responsible: "Current Owner",
  status,
  photoColor: "#000",
  photo: index === 0 ? "/photo.jpg" : undefined,
  quantity: index + 1,
  price: 100,
} satisfies InventoryItem));
ITEMS.push({
  ...ITEMS[0]!,
  id: "local-group-1",
  localGroupId: "local-group-1",
  sourceItemId: "item-0",
  name: "Local barcode group",
  inventoryNumber: "INV-0-0001",
  quantity: 2,
});
ITEMS.push({
  ...ITEMS[0]!,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  name: "Unicode inventory number",
  inventoryNumber: "ТМЦ № 42",
});

describe("TMC issue selection policy", () => {
  it("disables only the final write-off and exposes the reason next to it", () => {
    render(
      <ItemsTable
        items={ITEMS}
        itemReturnHref="/tmc/issue"
        bulkActions={{
          actorUserId: "owner-1",
          actorRole: "employee",
          buildings: [],
          rooms: [],
          variant: "issue",
        }}
      />,
    );

    const checkboxes = (name: string) =>
      screen.getAllByRole("checkbox", { name: `select:${name}` });

    for (const name of [
      "Active item",
      "Service item",
      "Write-off in use",
      "Local barcode group",
      "Unicode inventory number",
    ]) {
      for (const checkbox of checkboxes(name)) {
        expect((checkbox as HTMLInputElement).disabled).toBe(false);
      }
    }
    expect(screen.getAllByText("ТМЦ № 42").length).toBeGreaterThan(0);
    for (const checkbox of checkboxes("Final write-off")) {
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
      const container = checkbox.closest<HTMLElement>("article, tr")!;
      expect(within(container).getByText("tmc.issue.decommissionedBlocked")).not.toBeNull();
    }
  });
});
