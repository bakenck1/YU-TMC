import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import type { RoomWorkspaceDto } from "@/lib/contracts/room-workspace";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ProblemReportButton", () => ({
  default: () => <div>problem-report</div>,
}));

const ROOM: RoomWorkspaceDto = {
  access: "full",
  id: "11111111-1111-4111-8111-111111111111",
  designation: "101",
  buildingName: "Main",
  floorNumber: 1,
  floorLabel: null,
  responsibleName: null,
  itemCount: 0,
  connectedCount: 0,
  disconnectedCount: 0,
  items: [],
};

describe("room workspace navigation and denial", () => {
  it("printing staff see room contents without item links or problem reporting", () => {
    render(<RoomWorkspaceView room={{
      ...ROOM,
      items: [{ id: "item-1", name: "Monitor", inventoryNumber: "INV-1", description: "Room equipment", status: "active", condition: "good", connectionStatus: "connected", responsibleName: "Employee", photoUrl: null, createdAt: "2026-10-02T00:00:00Z", href: "/items/item-1" }],
    }} authenticated returnTo="/rooms/room-1" backTo="/inventory" readOnly />);
    expect(screen.getByText("Monitor")).toBeTruthy();
    expect(screen.getByText("Room equipment")).toBeTruthy();
    expect(screen.queryByText("problem-report")).toBeNull();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/inventory"]);
  });
  it("returns a room scan result to the scan screen", () => {
    render(
      <RoomWorkspaceView
        room={ROOM}
        authenticated
        returnTo="/rooms/11111111-1111-4111-8111-111111111111"
        backTo="/scan"
      />,
    );
    expect(screen.getByRole("link", { name: "scanner.backToScan" }).getAttribute("href"))
      .toBe("/scan");
  });

  it("renders no cabinet metadata for a denied workspace", () => {
    const { container } = render(
      <RoomWorkspaceView
        room={{ access: "denied", items: [] }}
        authenticated
        returnTo="/rooms/hidden"
      />,
    );
    expect(screen.getByText("room.accessClosed")).toBeTruthy();
    expect(container.textContent).not.toContain("101");
    expect(container.textContent).not.toContain("Main");
  });

  it("returns a denied room scan to the scan screen without exposing metadata", () => {
    render(
      <RoomWorkspaceView
        room={{ access: "denied", items: [] }}
        authenticated
        returnTo="/rooms/hidden"
        backTo="/scan"
      />,
    );
    expect(screen.getByRole("link", { name: "scanner.backToScan" }).getAttribute("href"))
      .toBe("/scan");
    expect(screen.getByText("room.accessClosed")).toBeTruthy();
  });
});
