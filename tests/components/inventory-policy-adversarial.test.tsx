import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { describe,expect,it,vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: string) => key === "status.broken" ? "Сломан" : key }) }));
vi.mock("@/components/TmcUserPicker", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCodeScanner", () => ({ default: () => null }));
vi.mock("@/components/InventoryItemCameraCapture", () => ({ default: ({ onCapture }: { onCapture: (v: unknown) => void }) => <button onClick={() => onCapture({ imageDataUrl: "data:image/jpeg;base64,eA==", width: 1, height: 1 })}>mock photo</button> }));
const ROOM = { id: "10000000-0000-4000-8000-000000000001", buildingId: "10000000-0000-4000-8000-000000000002", designation: "101", floorNumber: 1, floorLabel: null, qrCode: "ROOM-101", status: "active", version: 1, createdAt: "2026-10-04", updatedAt: "2026-10-04" } satisfies RoomDto;

describe("adversarial inventory policy UI", () => {

  const status = "broken";
  for (const number of ["", "COMP-123"]) {
    it("submits component with " + (number ? "filled" : "empty") + " number and " + status + " status", async () => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { id: ROOM.id } }), { status: 201 }));
      vi.stubGlobal("fetch", fetch);
      render(<InventoryItemCreateForm rooms={[ROOM]} openInitially />);
      fireEvent.change(screen.getByLabelText(/items.type/), { target: { value: "components" } });
      fireEvent.change(screen.getByLabelText(/items.name/), { target: { value: "Cable" } });
      fireEvent.change(screen.getByLabelText(/items.status/), { target: { value: status } });
      fireEvent.change(screen.getByLabelText(/createItem.barcode/), { target: { value: number } });
      fireEvent.click(screen.getByText("mock photo"));
      fireEvent.click(screen.getByRole("button", { name: "createItem.create" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      const payload = JSON.parse(fetch.mock.calls[0][1].body);
      expect(payload).toMatchObject({ category: "components", status: "broken", barcode: number || null });
      vi.unstubAllGlobals();
    });
  }
});
