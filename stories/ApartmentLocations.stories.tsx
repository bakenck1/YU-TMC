import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import ApartmentAddressFields from "@/components/ApartmentAddressFields";
import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import { apartmentDesignation } from "@/lib/apartment-locations";
import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";

const building: BuildingDto = { id: "demo-apartments", name: "Квартиры", address: "Актау", qrCode: "YUQ1:DEMO", roomCount: 3, status: "active", version: 1, createdAt: "", updatedAt: "" };
const rooms: RoomDto[] = [
  { microdistrict: "32", house: "12", entrance: "1", number: "18" },
  { microdistrict: "32", house: "14", entrance: "2", number: "21" },
  { microdistrict: "11", house: "3", entrance: "1", number: "7" },
].map((apartment, index) => ({ id: `demo-apartment-${index}`, buildingId: building.id, apartment,
  designation: apartmentDesignation(apartment), floorNumber: index + 1, floorLabel: null, qrCode: `DEMO-${index}`,
  accessMode: "open", status: "active", version: 1, createdAt: "", updatedAt: "" }));

const meta = {
  title: "Inventory/Apartments",
  component: InventoryBuildingsManager,
  parameters: { layout: "padded", nextjs: { appDirectory: false } },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "/api/settings") return Response.json(DEFAULT_APP_SETTINGS);
      if (url === "/api/auth/session") return Response.json({}, { status: 401 });
      if (url.includes("/api/users")) return Response.json({ users: [] });
      if (url.includes(`/api/inventory/buildings/${building.id}/rooms`)) return Response.json({ rooms });
      return original(input, init);
    };
    return () => { globalThis.fetch = original; };
  },
} satisfies Meta<typeof InventoryBuildingsManager>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MicrodistrictGroups: Story = { args: { actorRole: "admin", initialBuildings: [building] } };
export const AddressForm: Story = {
  args: { actorRole: "admin", initialBuildings: [] },
  render: function AddressFormStory() {
    const [address, setAddress] = useState({ microdistrict: "32", house: "12", entrance: "1", number: "18" });
    const [floor, setFloor] = useState("0");
    return <div className="max-w-lg rounded-2xl bg-white p-5"><ApartmentAddressFields value={address} onChange={setAddress} floor={floor} onFloorChange={setFloor} /></div>;
  },
};
