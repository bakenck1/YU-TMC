import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InventoryVisibleStatus from "@/components/InventoryVisibleStatus";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));

describe("InventoryVisibleStatus", () => {
  it("shows project ownership alongside the lifecycle status", () => {
    render(<InventoryVisibleStatus status={{ key: "lifecycle:active", kind: "lifecycle", value: "active" }} isProject />);
    expect(screen.getByText("status.active")).not.toBeNull();
    expect(screen.getByText("status.project")).not.toBeNull();
  });

  it("does not label ordinary inventory as project inventory", () => {
    render(<InventoryVisibleStatus status={{ key: "lifecycle:active", kind: "lifecycle", value: "active" }} />);
    expect(screen.queryByText("status.project")).toBeNull();
  });
});
