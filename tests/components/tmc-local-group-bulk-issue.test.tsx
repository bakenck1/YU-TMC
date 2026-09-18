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
      fullName: "Previous responsible",
      email: "previous@example.test",
      role: "employee",
    })}>choose-recipient</button>
  ),
}));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function localGroup(quantity: number): InventoryItem {
  return {
    id: GROUP_ID,
    localGroupId: GROUP_ID,
    sourceItemId: SOURCE_ITEM_ID,
    name: "Local chair group",
    inventoryNumber: "123/456-0001",
    category: "furniture",
    building: "The Main Campus",
    room: "101",
    location: "The Main Campus / 1 floor / 101",
    responsibleId: OWNER_ID,
    responsible: "Current owner",
    status: "active",
    photoColor: "#000",
    quantity,
    price: 100,
    version: 7,
  };
}

describe("TMC issue wiring for local barcode groups", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("uses the local group's source metadata without an unnecessary distribution request", () => {
    renderBulk(localGroup(2));

    openIssueDialog();

    expect(fetch).not.toHaveBeenCalled();
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("2");
  });

  it("submits even a one-unit local group as a source-group quantity transfer", async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => ({
      ok: true,
      json: async () => init?.method === "POST" ? ({
        result: {
          request: null,
          total: 1,
          included: 0,
          problems: 1,
          items: [{
            itemId: SOURCE_ITEM_ID,
            outcome: "problem",
            problem: "active_transfer_exists",
          }],
        },
      }) : ({ distribution: distribution(1) }),
    } as Response));
    renderBulk(localGroup(1));

    openIssueDialog();
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    const submit = screen.getByRole("button", { name: "tmc.bulk.submitTransfer" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const [, init] = vi.mocked(fetch).mock.calls.find(([, request]) => request?.method === "POST")!;
    expect(JSON.parse(String(init?.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: [SOURCE_ITEM_ID],
      quantityTransfers: [{
        itemId: SOURCE_ITEM_ID,
        sourceLocalGroupId: GROUP_ID,
        sourceVersion: 7,
        quantity: 1,
      }],
      comment: null,
    });
  });
});

function renderBulk(item: InventoryItem) {
  render(
    <TmcBulkActions
      items={[item]}
      actorUserId={OWNER_ID}
      actorRole="employee"
      variant="issue"
      buildings={[]}
      rooms={[]}
      onComplete={vi.fn()}
    />,
  );
}

function openIssueDialog() {
  fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "tmc.operation.issue" }));
}

function distribution(quantity: number) {
  return {
    itemId: SOURCE_ITEM_ID,
    itemName: "Local chair group",
    originalBarcode: "123/456",
    originalQuantity: quantity,
    originalVersion: 7,
    originalRemainder: quantity,
    originalResponsible: { id: OWNER_ID, fullName: "Current owner" },
    originalLocation: {
      roomId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      roomDesignation: "101",
      buildingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      buildingName: "The Main Campus",
    },
    groups: [],
  };
}
