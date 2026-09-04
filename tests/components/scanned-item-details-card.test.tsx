import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ScannedItemDetailsCard from "@/components/ScannedItemDetailsCard";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    locale: "ru-RU",
    t: (key: string) => key,
  }),
}));

type ScannedItem = NonNullable<QrResolutionDto["target"]> & { kind: "item" };

const ITEM: ScannedItem = {
  kind: "item",
  id: "33333333-3333-4333-8333-333333333333",
  status: "active",
  title: "Laptop",
  inventoryNumber: "INV-42",
  responsibleName: "Current owner",
  responsibleId: "22222222-2222-4222-8222-222222222222",
  isAssigned: true,
  isCurrentUserResponsible: false,
  itemDetails: {
    itemType: "electronics",
    brand: "Dell",
    model: "Latitude",
    description: "Office laptop",
    quantity: 1,
    unitPrice: 350_000,
    condition: "good",
    connectionStatus: "connected",
    photoUrl: "/api/inventory/qr/item-photo?value=INV-42&kind=barcode",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
};

describe("ScannedItemDetailsCard", () => {
  it("shows a prominent lifecycle status and opens the photo viewer", () => {
    const { rerender } = render(<ScannedItemDetailsCard item={ITEM} />);

    expect(screen.getAllByText("status.active").length).toBeGreaterThan(0);
    expect(screen.getByText("item.condition")).not.toBeNull();
    expect(screen.queryByText("condition.good")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "itemDetails.openPhoto" }));
    expect(screen.getByRole("dialog", { name: "itemDetails.photoFullSize" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<ScannedItemDetailsCard item={{ ...ITEM, status: "maintenance" }} />);
    expect(screen.getAllByText("status.maintenance").length).toBeGreaterThan(0);

    rerender(<ScannedItemDetailsCard item={{ ...ITEM, status: "decommissioned" }} />);
    expect(screen.getAllByText("status.decommissioned").length).toBeGreaterThan(0);
  });
});
