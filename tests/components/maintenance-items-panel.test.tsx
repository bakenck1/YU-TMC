import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MaintenanceItemsPanel from "@/components/MaintenanceItemsPanel";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ locale: "en-US", t: (key: string) => key }) }));
afterEach(() => vi.unstubAllGlobals());
const item: InventoryItemDto = {
  id: "repair-item", name: "Repairable microscope", description: null, itemType: "equipment", category: "equipment",
  brand: null, model: null, quantity: 1, unitPrice: 100, inventoryNumber: "M-1", inventoryNumberKind: "official",
  room: { id: "room", designation: "101", floorNumber: 1, buildingId: "building", buildingName: "Campus" },
  responsible: null, status: "maintenance", qrCode: null, photoUrl: null, version: 1,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", archivedAt: null,
};

it.each([["maintenance.returnActive", "active"], ["maintenance.writeOff", "decommissioned"]])("%s removes the repaired item only after the change succeeds", async (action, status) => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    expect(JSON.parse(options.body)).toMatchObject({ operation: "resolve_maintenance", status, version: item.version });
    return new Promise<Response>(resolve => { finish = resolve; });
  }));
  render(<MaintenanceItemsPanel initialItems={[item]} canManage />);
  fireEvent.click(screen.getByRole("button", { name: action }));
  expect(screen.getByRole("link", { name: item.name })).toBeTruthy();
  finish(Response.json({ item: { ...item, status, version: 2 } }));
  await waitFor(() => expect(screen.queryByRole("link", { name: item.name })).toBeNull());
});

it("keeps a failed repair actionable and lets the operator retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 })).mockResolvedValueOnce(Response.json({ item: { ...item, status: "active", version: 2 } }));
  vi.stubGlobal("fetch", fetcher);
  render(<MaintenanceItemsPanel initialItems={[item]} canManage />);
  fireEvent.click(screen.getByRole("button", { name: "maintenance.returnActive" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("link", { name: item.name })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "maintenance.returnActive" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: item.name })).toBeNull());
});
