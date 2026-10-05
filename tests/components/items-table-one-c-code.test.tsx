import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ItemsTable from "@/components/ItemsTable";
import type { InventoryColumnVisibility } from "@/lib/inventory-columns";
import { createInventoryExportPayload } from "@/lib/inventory-export";
import type { InventoryItem } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    t: (key: string) => key === "items.oneCCode" ? "Код 1С" : key,
  }),
}));
vi.mock("@/components/InventoryExportButton", () => ({
  default: ({ columns }: { columns: InventoryColumnVisibility }) => (
    <output aria-label="export columns">
      {JSON.stringify(createInventoryExportPayload("items", [], columns).columns)}
    </output>
  ),
}));
vi.mock("@/components/InventoryInvoiceActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCreateForm", () => ({
  default: ({ canViewOneCCode }: { canViewOneCCode: boolean }) => (
    <output aria-label="create form code permission">{String(canViewOneCCode)}</output>
  ),
}));
vi.mock("@/components/TmcBulkActions", () => ({ default: () => null }));
vi.mock("@/components/InventoryThumbnail", () => ({ default: () => null }));
vi.mock("@/components/InventoryVisibleStatus", () => ({ default: () => null }));

const ITEM: InventoryItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ноутбук Lenovo IdeaPad",
  inventoryNumber: "2411/00388",
  oneCCode: "000003254",
  category: "electronics",
  location: "Main / 101",
  responsible: "Employee",
  status: "active",
  photoColor: "#000",
};

describe("ItemsTable 1C code column", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/items");
  });

  it("shows the code after the name, preserves leading zeroes and uses a dash for an absent code", () => {
    render(<ItemsTable items={[ITEM, { ...ITEM, id: "22222222-2222-4222-8222-222222222222", name: "Без кода", oneCCode: undefined }]} canViewOneCCode />);

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    const nameIndex = headers.indexOf("items.name");
    expect(headers.slice(nameIndex, nameIndex + 3)).toEqual(["items.name", "Код 1С", "items.type"]);
    const rows = table.querySelectorAll("tbody tr");
    expect(within(rows[0] as HTMLElement).getAllByRole("cell")[nameIndex + 1]?.textContent).toBe("000003254");
    expect(within(rows[1] as HTMLElement).getAllByRole("cell")[nameIndex + 1]?.textContent).toBe("—");
    const cards = screen.getAllByRole("article");
    expect(within(cards[0]!).getByText("000003254")).not.toBeNull();
    expect(within(cards[0]!).getByText("Код 1С")).not.toBeNull();
  });

  it("adds the default code column to old preferences while keeping the user's existing choices", async () => {
    window.localStorage.setItem("yu-inventory:item-columns:v1:admin", JSON.stringify({ photo: false, name: true, itemType: false, price: false }));
    render(<ItemsTable items={[ITEM]} columnSettingsScope="admin" canViewOneCCode />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Код 1С" })).not.toBeNull();
    await waitFor(() => expect(within(table).queryByRole("columnheader", { name: "items.photo" })).toBeNull());
    expect(within(table).queryByRole("columnheader", { name: "items.type" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "items.price" })).toBeNull();
  });

  it("persists a hidden code column across reloads and omits it from the matching list export", async () => {
    const view = render(<ItemsTable items={[ITEM]} columnSettingsScope="admin" excelDataset="items" canViewOneCCode />);
    fireEvent.click(screen.getByRole("button", { name: "items.columnSettings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Код 1С" }));

    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull());
    expect(screen.queryByText("000003254")).toBeNull();
    expect(screen.getByLabelText("export columns").textContent).not.toContain("oneCCode");
    view.unmount();

    render(<ItemsTable items={[ITEM]} columnSettingsScope="admin" canViewOneCCode />);
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "items.columnSettings" }));
    expect((screen.getByRole("checkbox", { name: "Код 1С" }) as HTMLInputElement).checked).toBe(false);
  });

  it("keeps unsupported code controls out of the IT list even with general-list preferences", () => {
    window.localStorage.setItem("yu-inventory:item-columns:v1:admin", JSON.stringify({ oneCCode: true }));
    render(<ItemsTable items={[{ ...ITEM, itemSection: "it", category: "camera" }]} columnSettingsScope="admin" variant="it" canViewOneCCode />);

    expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull();
    expect(screen.queryByText("000003254")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "items.columnSettings" }));
    expect(screen.queryByRole("checkbox", { name: "Код 1С" })).toBeNull();
  });

  it("denies code visibility by default, including desktop, mobile, preferences and the export payload", () => {
    window.localStorage.setItem("yu-inventory:item-columns:v1:unknown", JSON.stringify({ oneCCode: true }));
    render(<ItemsTable items={[ITEM]} columnSettingsScope="unknown" excelDataset="items" />);

    expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull();
    expect(screen.queryByText("000003254")).toBeNull();
    expect(screen.getByLabelText("export columns").textContent).not.toContain("oneCCode");
    fireEvent.click(screen.getByRole("button", { name: "items.columnSettings" }));
    expect(screen.queryByRole("checkbox", { name: "Код 1С" })).toBeNull();
  });

  it.each(["employee", "warehouse", "typography"])("cannot enable the code column for %s through saved preferences or reset", async (role) => {
    window.localStorage.setItem(`yu-inventory:item-columns:v1:${role}`, JSON.stringify({ oneCCode: true, photo: false }));
    render(<ItemsTable items={[ITEM]} columnSettingsScope={role} excelDataset="items" canViewOneCCode={false} />);

    await waitFor(() => expect(within(screen.getByRole("table")).queryByRole("columnheader", { name: "items.photo" })).toBeNull());
    expect(screen.queryByText("000003254")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "items.columnSettings" }));
    expect(screen.queryByRole("checkbox", { name: "Код 1С" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "items.resetColumns" }));
    expect(screen.queryByText("000003254")).toBeNull();
    expect(screen.getByLabelText("export columns").textContent).not.toContain("oneCCode");
  });

  it("removes code visibility synchronously when server permission is revoked without waiting for preference hydration", () => {
    const view = render(<ItemsTable items={[ITEM]} columnSettingsScope="admin" excelDataset="items" canViewOneCCode />);
    expect(screen.getByRole("columnheader", { name: "Код 1С" })).not.toBeNull();
    expect(screen.getByLabelText("export columns").textContent).toContain("oneCCode");

    view.rerender(<ItemsTable items={[ITEM]} columnSettingsScope="admin" excelDataset="items" canViewOneCCode={false} />);

    expect(screen.queryByRole("columnheader", { name: "Код 1С" })).toBeNull();
    expect(screen.queryByText("000003254")).toBeNull();
    expect(screen.getByLabelText("export columns").textContent).not.toContain("oneCCode");
  });

  it.each([false, true])("passes the authenticated code permission to its creation form: %s", (canViewOneCCode) => {
    render(<ItemsTable items={[ITEM]} canViewOneCCode={canViewOneCCode} itemCreation={{ rooms: [], buildings: [], mode: "full" }} />);
    expect(screen.getByLabelText("create form code permission").textContent).toBe(String(canViewOneCCode));
  });
});
