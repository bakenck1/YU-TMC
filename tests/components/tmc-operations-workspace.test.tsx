import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TmcLanding from "@/components/TmcLanding";
import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";
import type { InventoryItem } from "@/lib/types";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/PushNotificationControl", () => ({ default: () => <div>push-control</div> }));
vi.mock("@/components/TmcNotifications", () => ({ default: () => <div>notifications</div> }));
vi.mock("@/components/TmcOperationShell", () => ({
  default: ({ issueItems }: { issueItems?: InventoryItem[] }) => <div>issue-shell:{issueItems?.length ?? 0}</div>,
}));

const REQUEST: TmcTransferRequestCardView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  initiator: { fullName: "Sender User", email: "sender@example.test" },
  recipient: { fullName: "Recipient User", email: "recipient@example.test" },
  status: "pending",
  comment: "Please accept",
  createdAt: "2026-08-10T00:00:00.000Z",
  overdue: false,
  version: 1,
  summary: { total: 2, pending: 2, accepted: 0 },
  items: [],
};

describe("TmcLanding operations workspace", () => {
  it("shows incoming requests first and opens the partial decision card", () => {
    render(<TmcLanding incomingRequests={[REQUEST]} issueItems={[]} actorUserId="user-1" actorRole="employee" />);

    expect(screen.getByRole("tab", { name: "tmc.operation.receive", selected: true })).not.toBeNull();
    expect(screen.getByText("Sender User")).not.toBeNull();
    expect(screen.getByText("tmc.incoming.pendingCount:{\"pending\":2,\"total\":2}")).not.toBeNull();
    expect(screen.getByRole("link", { name: "tmc.incoming.openRequest" }).getAttribute("href")).toBe(`/tmc/transfer-requests/${REQUEST.id}`);
  });

  it("opens issue flow with owned items and hides transfer tab from non-admin users", () => {
    render(<TmcLanding incomingRequests={[]} issueItems={[{ id: "item-1" } as InventoryItem]} actorUserId="user-1" actorRole="employee" />);

    expect(screen.queryByRole("tab", { name: "tmc.operation.transfer" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "tmc.operation.issue" }));
    expect(screen.getByText("issue-shell:1")).not.toBeNull();
  });

  it("keeps the transfer workspace visible only to administrators", () => {
    render(<TmcLanding incomingRequests={[]} issueItems={[]} actorUserId="admin-1" actorRole="admin" />);
    expect(screen.getByRole("tab", { name: "tmc.operation.transfer" })).not.toBeNull();
  });
});
