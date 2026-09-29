import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import InventoryRoomFormModal from "@/components/InventoryRoomFormModal";
import type { BuildingDto } from "@/lib/contracts/inventory-locations";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/TmcUserPicker", () => ({ default: () => null }));

afterEach(() => vi.unstubAllGlobals());

it("keeps the room form open and explains a duplicate conflict", async () => {
  const onSave = vi.fn();
  const fetchMock = vi.fn(async () => Response.json({ error: "room_already_exists" }, { status: 409 }));
  vi.stubGlobal("fetch", fetchMock);
  const building: BuildingDto = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "The Main Campus",
    address: "Campus",
    roomCount: 1,
    qrCode: "building-qr",
    status: "active",
    version: 1,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  render(<InventoryRoomFormModal building={building} room={null} onClose={vi.fn()} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText("inventory.roomDesignation"), { target: { value: "К 201" } });
  fireEvent.change(screen.getByLabelText("inventory.floor"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "common.save" }));
  expect(await screen.findByText("inventory.roomAlreadyExists")).toBeTruthy();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect((screen.getByLabelText("inventory.roomDesignation") as HTMLInputElement).value).toBe("К 201");
  expect(onSave).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
