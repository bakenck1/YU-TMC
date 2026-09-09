import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InventoryInvoiceActions from "@/components/InventoryInvoiceActions";
import type { InventoryItem } from "@/lib/types";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    settings: { organizationName: "YU Inventory" },
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

const ITEM = {
  id: "item-1",
  name: "Моноблок",
  inventoryNumber: "INV-001",
  category: "electronics",
  location: "Корпус A / 101",
  responsible: "Иванов Иван",
  status: "active",
  photoColor: "#000000",
  quantity: 20,
  price: 125_000,
} satisfies InventoryItem;

describe("InventoryInvoiceActions", () => {
  it("keeps the action available but prevents a blank invoice when no items are selected", () => {
    render(<InventoryInvoiceActions items={[]} recipientName="Иванов Иван" />);

    fireEvent.click(screen.getByRole("button", { name: "invoice.action" }));

    expect(screen.getByRole("status").textContent).toBe("invoice.noSelection");
    expect(screen.getByRole("button", { name: /invoice.small/ }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: /invoice.large/ }).getAttribute("disabled")).not.toBeNull();
  });

  it("opens the prefilled form and writes the selected large invoice to a print window", () => {
    const documentOpen = vi.fn();
    const documentWrite = vi.fn();
    const documentClose = vi.fn();
    const focus = vi.fn();
    const print = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({
      document: { open: documentOpen, write: documentWrite, close: documentClose },
      focus,
      print,
      opener: window,
    } as unknown as Window);

    render(<InventoryInvoiceActions items={[ITEM]} recipientName="Иванов Иван" />);
    fireEvent.click(screen.getByRole("button", { name: "invoice.action" }));

    expect(screen.getByRole("dialog", { name: "invoice.title" })).not.toBeNull();
    expect(screen.getByDisplayValue("YU Inventory")).not.toBeNull();
    expect(screen.getByDisplayValue("Иванов Иван")).not.toBeNull();
    expect(screen.getByText('invoice.selectedSummary:{"count":1,"quantity":20}')).not.toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "invoice.number" }), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /invoice.large/ }));

    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(documentOpen).toHaveBeenCalledTimes(1);
    expect(documentClose).toHaveBeenCalledTimes(1);
    expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining("data-invoice-copy=\"1\""));
    expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining("Моноблок"));
    expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining("№ 42"));
  });
});
