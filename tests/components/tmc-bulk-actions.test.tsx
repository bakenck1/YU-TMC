import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TmcBulkActions from "@/components/TmcBulkActions";
import type { InventoryItem } from "@/lib/types";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/TmcUserPicker", () => ({
  default: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button type="button" onClick={() => onChange({
      id: "22222222-2222-4222-8222-222222222222",
      fullName: "Recipient User",
      email: "recipient@example.test",
      role: "employee",
    })}>choose-recipient</button>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ITEM = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Laptop",
  inventoryNumber: "INV-001",
  category: "Компьютеры",
  buildingId: "33333333-3333-4333-8333-333333333333",
  building: "Old building",
  roomId: "44444444-4444-4444-8444-444444444444",
  room: "101",
  location: "Old building / 101",
  responsibleId: "11111111-1111-4111-8111-111111111111",
  responsible: "Current User",
  status: "active",
  photoColor: "#000000",
  version: 3,
} satisfies InventoryItem;

describe("TmcBulkActions", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("renders a bright actions tab and opens its menu below the sticky row", () => {
    const onClear = vi.fn();
    const second = { ...ITEM, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Monitor", inventoryNumber: "INV-002" };
    render(<TmcBulkActions
      items={[ITEM, second]}
      actorUserId={ITEM.responsibleId}
      actorRole="admin"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
      onClear={onClear}
    />);

    const trigger = screen.getByRole("button", { name: "tmc.bulk.actions" });
    expect(trigger.parentElement?.className).toContain("relative");
    expect(trigger.className).toContain("min-h-12");
    expect(trigger.className).toContain("bg-emerald-500");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "tmc.bulk.changeLocation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "tmc.bulk.transfer" })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu").className).toContain("top-full");
    expect(screen.getByText('items.selected:{"count":2}')).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "tmc.bulk.changeLocation" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "tmc.bulk.transfer" })).not.toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "tmc.bulk.clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("creates one request for selected rows and displays per-row problems", async () => {
    const second = { ...ITEM, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Monitor", inventoryNumber: "INV-002" };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          request: null,
          total: 2,
          included: 0,
          problems: 2,
          items: [
            { itemId: ITEM.id, outcome: "problem", problem: "active_transfer_exists" },
            { itemId: second.id, outcome: "problem", problem: "active_transfer_exists" },
          ],
        },
      }),
    } as Response);
    render(<TmcBulkActions
      items={[ITEM, second]}
      actorUserId={ITEM.responsibleId}
      actorRole="employee"
      variant="issue"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "tmc.operation.issue" }));
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.submitTransfer" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/inventory/transfer-requests",
      expect.objectContaining({ method: "POST" }),
    );
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: [ITEM.id, second.id],
      comment: null,
    });
    expect(screen.getAllByText("tmc.problem.active_transfer_exists")).toHaveLength(2);
  });

  it("keeps responsibility transfer admin-only outside issue flow", () => {
    const { rerender } = render(<TmcBulkActions
      items={[ITEM]}
      actorUserId={ITEM.responsibleId}
      actorRole="employee"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
    />);
    expect(screen.queryByRole("button", { name: "tmc.bulk.transfer" })).toBeNull();

    rerender(<TmcBulkActions
      items={[ITEM]}
      actorUserId={ITEM.responsibleId}
      actorRole="employee"
      variant="issue"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
    expect(screen.getByRole("menuitem", { name: "tmc.operation.issue" })).not.toBeNull();
  });

  it("removes an item from the operation and submits only the remaining rows", async () => {
    const second = { ...ITEM, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Monitor", inventoryNumber: "INV-002" };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          request: null,
          total: 1,
          included: 0,
          problems: 1,
          items: [{ itemId: second.id, outcome: "problem", problem: "active_transfer_exists" }],
        },
      }),
    } as Response);
    render(<TmcBulkActions
      items={[ITEM, second]}
      actorUserId={ITEM.responsibleId}
      actorRole="admin"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "tmc.bulk.transfer" }));
    expect(screen.getByText("tmc.bulk.assignmentExplanation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `tmc.bulk.removeItem:${JSON.stringify({ name: ITEM.name })}` }));
    expect(screen.queryByText(ITEM.name)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.submitAssignment" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).itemIds).toEqual([second.id]);
  });

  it("offers admin-only location change and submits item versions with a directory room", async () => {
    const second = { ...ITEM, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Monitor", inventoryNumber: "INV-002", version: 7 };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          total: 2,
          succeeded: 2,
          problems: 0,
          items: [
            { itemId: ITEM.id, outcome: "success", itemVersion: 4 },
            { itemId: second.id, outcome: "success", itemVersion: 8 },
          ],
        },
      }),
    } as Response);
    const onComplete = vi.fn();
    const { rerender } = render(<TmcBulkActions
      items={[ITEM, second]}
      actorUserId={ITEM.responsibleId}
      actorRole="employee"
      buildings={[]}
      rooms={[]}
      onComplete={onComplete}
    />);
    expect(screen.queryByRole("button", { name: "tmc.bulk.changeLocation" })).toBeNull();

    rerender(<TmcBulkActions
      items={[ITEM, second]}
      actorUserId={ITEM.responsibleId}
      actorRole="admin"
      buildings={[{
        id: "55555555-5555-4555-8555-555555555555",
        name: "Main campus",
        address: "Campus",
        qrCode: "BLDG",
        roomCount: 1,
        status: "active",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }]}
      rooms={[{
        id: "66666666-6666-4666-8666-666666666666",
        buildingId: "55555555-5555-4555-8555-555555555555",
        designation: "204",
        floorNumber: 2,
        floorLabel: null,
        primaryResponsible: null,
        qrCode: "ROOM",
        status: "active",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }]}
      onComplete={onComplete}
    />);
    expect(screen.queryByRole("button", { name: "tmc.bulk.changeLocation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "tmc.bulk.transfer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
    expect(screen.getByRole("menuitem", { name: "tmc.bulk.changeLocation" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "tmc.bulk.transfer" })).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "tmc.bulk.changeLocation" }));
    fireEvent.change(screen.getByLabelText("tmc.bulk.building"), {
      target: { value: "55555555-5555-4555-8555-555555555555" },
    });
    fireEvent.change(screen.getByLabelText("tmc.bulk.room"), {
      target: { value: "66666666-6666-4666-8666-666666666666" },
    });
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.submitLocation" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      roomId: "66666666-6666-4666-8666-666666666666",
      items: [
        { itemId: ITEM.id, itemVersion: 3 },
        { itemId: second.id, itemVersion: 7 },
      ],
      comment: null,
    });
  });
});
