import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InventoryInformationPanel from "@/components/InventoryInformationPanel";
import type { InventoryItemOperationDto } from "@/lib/contracts/inventory-items";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    locale: "en-US",
    t: (key: string) => key,
  }),
}));

const OPERATION: InventoryItemOperationDto = {
  id: "operation-1",
  kind: "item",
  action: "item.created",
  actorName: "Demo User 1",
  actorEmail: null,
  occurredAt: "2026-08-25T10:00:00.000Z",
  detail: null,
};

describe("legacy inventory information panel", () => {
  it("renders supplied operations without inventing an actor", () => {
    render(<InventoryInformationPanel operations={[OPERATION]} />);

    expect(screen.getByText(/Demo User 1/)).toBeTruthy();
    expect(screen.getByText("itemDetails.auditCreated")).toBeTruthy();
    expect(screen.queryByText(/demo-user\.demo-user/i)).toBeNull();
  });

  it("shows an explicit empty state when no operations are available", () => {
    render(<InventoryInformationPanel />);

    expect(screen.getByText("itemDetails.operationsEmpty")).toBeTruthy();
  });
});
