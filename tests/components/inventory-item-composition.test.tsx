import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InventoryItemComposition from "@/components/InventoryItemComposition";
import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));

const LOCAL_PART: LocalBarcodeGroupDto = {
  id: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  itemName: "Стул",
  originalBarcode: "4587/8486",
  itemType: "furniture",
  brand: null,
  model: null,
  description: null,
  unitPrice: 1000,
  photoUrl: null,
  localBarcode: "4587/8486-0001",
  parentGroupId: null,
  quantity: 5,
  responsible: { id: "33333333-3333-4333-8333-333333333333", fullName: "Сотрудник Б" },
  previousResponsible: { id: "44444444-4444-4444-8444-444444444444", fullName: "Сотрудник А" },
  location: {
    roomId: "55555555-5555-4555-8555-555555555555",
    roomDesignation: "201A",
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Главный корпус",
  },
  transferredAt: "2026-09-01T10:00:00.000Z",
  status: "active",
  version: 1,
  cancellation: null,
};

describe("InventoryItemComposition", () => {
  it("shows transferred local parts as automatically linked related items", () => {
    render(
      <InventoryItemComposition
        itemId={LOCAL_PART.itemId}
        initialComponents={[]}
        localGroups={[LOCAL_PART]}
        canManage={false}
      />,
    );

    expect(screen.getByText("Локальные части")).toBeTruthy();
    expect(screen.getByText("Части, переданные из этой ТМЦ, связываются автоматически.")).toBeTruthy();
    expect(screen.getByText(LOCAL_PART.localBarcode)).toBeTruthy();
    expect(screen.getByText("Количество: 5 · Сотрудник Б")).toBeTruthy();
    expect(screen.getByRole("link", { name: /4587\/8486-0001/ }).getAttribute("href"))
      .toBe(`/local-barcodes/${LOCAL_PART.id}`);
  });
});
