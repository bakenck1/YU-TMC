import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CampusItemCard from "@/components/CampusItemCard";
import type { CampusItem } from "@/lib/campus";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    dataLabel: (value: string) => value,
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

describe("campus item Code 39", () => {
  it("encodes a real database-valid inventory number longer than 16 characters", () => {
    render(
      <CampusItemCard
        item={item("INVENTORY-NUMBER-42")}
        buildingName="The Main Campus"
      />,
    );

    expect(screen.getByTestId("campus-item-code39")).not.toBeNull();
    expect(screen.queryByText("map.barcodeMissing")).toBeNull();
    expect(screen.getAllByText("INVENTORY-NUMBER-42").length).toBeGreaterThan(0);
  });

  it("shows an explicit missing-barcode state instead of generating a code from the item id", () => {
    render(<CampusItemCard item={item("")} buildingName="The Main Campus" />);

    expect(screen.queryByTestId("campus-item-code39")).toBeNull();
    expect(screen.getByText("map.barcodeMissing")).not.toBeNull();
  });

  it("opens the real item photo at full size", () => {
    render(
      <CampusItemCard
        item={{ ...item("INV-42"), photoUrl: "/api/inventory/items/item-1/photo" }}
        buildingName="The Main Campus"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "map.openPhoto" }));
    expect(screen.getByRole("dialog", { name: "map.openPhoto" })).not.toBeNull();
    expect(screen.getAllByRole("img", { name: "Long-number asset" }).length).toBe(2);
  });

  it("keeps final write-off and write-off-in-use as separate statuses", () => {
    const view = render(
      <CampusItemCard
        item={{ ...item("INV-42"), status: "decommissioned_in_use" }}
        buildingName="The Main Campus"
      />,
    );
    expect(screen.getByText("status.decommissioned_in_use")).not.toBeNull();
    expect(screen.queryByText("status.decommissioned")).toBeNull();

    view.rerender(
      <CampusItemCard
        item={{ ...item("INV-42"), status: "decommissioned" }}
        buildingName="The Main Campus"
      />,
    );
    expect(screen.getByText("status.decommissioned")).not.toBeNull();
    expect(screen.queryByText("status.decommissioned_in_use")).toBeNull();
  });
});

function item(invNo: string): CampusItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Long-number asset",
    category: "electronics",
    invNo,
    photoUrl: null,
    status: "ok",
    lastInv: "2026-09-18",
    responsible: "Employee",
    history: [],
    room: "101",
    code: "101",
    floorN: 1,
    buildingId: "main",
  };
}
