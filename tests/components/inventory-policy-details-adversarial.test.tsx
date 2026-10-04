import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { UserRole } from "@/lib/contracts/users";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: "ru", locale: "ru-RU", t: (key: string) => key }) }));
vi.mock("@/components/InventoryItemQrDialogs", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemArchiveDialog", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemServiceDialog", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCameraCapture", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemComposition", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemBackLink", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemComments", () => ({ default: () => null }));
vi.mock("@/components/LocalBarcodeDistributionPanel", () => ({ default: () => null }));
vi.mock("@/components/TmcUserPicker", () => ({ default: () => null }));
const ITEM: InventoryItemDto = { id: "10000000-0000-4000-8000-000000000001", name: "Old equipment", description: "Keep", itemSection: "general", itemType: "Старое лабораторное оборудование", category: "Старое лабораторное оборудование", brand: null, model: null, quantity: 1, unitPrice: 5, inventoryNumber: "INV-OLD", inventoryNumberKind: "official", room: { id: "10000000-0000-4000-8000-000000000002", designation: "101", floorNumber: 1, buildingId: "10000000-0000-4000-8000-000000000003", buildingName: "Main" }, status: "active", responsible: { id: "10000000-0000-4000-8000-000000000004", name: "Owner" }, qrCode: null, photoUrl: null, version: 1, createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z", archivedAt: null };
function view(role: UserRole = "warehouse", editing = false, item = ITEM) { return render(<InventoryItemDetails initialItem={item} canEditContent={role === "admin" || role === "warehouse"} canSendToService={false} requiresServicePhoto={false} canManageCode={false} operations={[]} initialComments={[]} canComment={false} canManageProtected={false} rooms={[]} initialComponents={[]} canManageComponents={false} actorId={ITEM.id} actorRole={role} hideComposition initialEditing={editing} />); }
afterEach(() => vi.unstubAllGlobals());
describe("adversarial legacy category and role repair UI", () => {
  it("renders the old category and never replaces its text with electronics", () => {
    view(); expect(screen.getAllByText(ITEM.itemType).length).toBeGreaterThan(0); expect(screen.queryByText("common.electronics")).toBeNull();
  });
  it("content editor displays old category as disabled placeholder and submits no category for unrelated edit", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { ...ITEM, name: "Edited", version: 2 } }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    view("warehouse", true); const dialog = screen.getByRole("dialog"); const select = within(dialog).getByLabelText("items.type") as HTMLSelectElement;
    expect(select.selectedOptions[0].text).toBe(ITEM.itemType); expect(select.selectedOptions[0].disabled).toBe(true);
    expect([...select.options].filter(o => !o.disabled).map(o => o.value)).toEqual(["electronics", "electrical_equipment", "furniture", "household_inventory", "components"]);
    fireEvent.change(within(dialog).getByLabelText("items.name"), { target: { value: "Edited" } }); fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const body = JSON.parse(fetch.mock.calls[0][1].body); expect(body.name).toBe("Edited"); expect(body).not.toHaveProperty("category");
  });
  it("warehouse repair button sends only status revision and operation", async () => {
    const broken = { ...ITEM, status: "broken" as const }; const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { ...broken, status: "active", version: 2 } }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    view("warehouse", false, broken); fireEvent.click(screen.getByRole("button", { name: "itemDetails.statusActive" })); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operation: "change_status", version: 1, status: "active" });
  });
  for (const role of ["employee", "typography"] as const) it(role + " never sees broken repair button", () => {
    view(role, false, { ...ITEM, status: "broken" }); expect(screen.queryByRole("button", { name: "itemDetails.statusActive" })).toBeNull();
  });
});
