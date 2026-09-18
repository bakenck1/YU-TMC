import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TmcItemQrFlow from "@/components/TmcItemQrFlow";
import { TMC_OPERATION_BY_ID } from "@/lib/tmc-navigation";
import type { InventoryItem } from "@/lib/types";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock("@/components/InventoryItemCodeScanner", () => ({
  default: () => <div data-testid="barcode-scanner">scanner</div>,
}));
vi.mock("@/components/ItemsTable", () => ({
  default: ({ items }: { items: InventoryItem[] }) => (
    <div data-testid="issue-items">
      {items.map((item) => <span key={item.id}>{item.id}:{item.status}</span>)}
    </div>
  ),
}));
vi.mock("@/components/ScannedItemDetailsCard", () => ({ default: () => null }));
vi.mock("@/components/TmcUserPicker", () => ({ default: () => null }));
vi.mock("@/components/LocalBarcodeTransferResult", () => ({ default: () => null }));

const ITEMS = ([
  ["active", "active"],
  ["maintenance", "maintenance"],
  ["decommissioned", "decommissioned"],
  ["decommissioned-in-use", "decommissioned_in_use"],
] as const).map(([id, status]) => ({
  id,
  name: id,
  inventoryNumber: `INV-${id}`,
  category: "electronics",
  location: "Main / 101",
  responsible: "Owner",
  status,
  photoColor: "#000",
  quantity: 1,
  price: 1,
} satisfies InventoryItem));

describe("TMC issue initial workspace", () => {
  it("shows all owned statuses and an explicit scan button without mounting the camera", () => {
    render(
      <TmcItemQrFlow
        operation={TMC_OPERATION_BY_ID.issue}
        issueItems={ITEMS}
        actorUserId="owner-1"
        actorRole="employee"
      />,
    );

    expect(screen.queryByTestId("barcode-scanner")).toBeNull();
    expect(screen.getByTestId("issue-items")).not.toBeNull();
    for (const item of ITEMS) {
      expect(screen.getByText(`${item.id}:${item.status}`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "tmc.qr.scan" })).not.toBeNull();
  });
});
