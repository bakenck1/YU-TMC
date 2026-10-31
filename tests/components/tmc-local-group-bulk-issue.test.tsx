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
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByText("tmc.localBarcode.quantityQuestion")).toBeNull();
  });

  it.each([1, 5])("submits all %s units of a local group with its source metadata", async (quantity) => {
    vi.mocked(fetch).mockResolvedValue(problemResponse([SOURCE_ITEM_ID]));
    renderBulk(localGroup(quantity));

    openIssueDialog();
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    const submit = screen.getByRole("button", { name: "tmc.bulk.submitTransfer" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await screen.findByText("tmc.problem.active_transfer_exists");
    expect(screen.queryByText(SOURCE_ITEM_ID)).toBeNull();
    expect(screen.getAllByText("Local chair group")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/inventory/transfer-requests");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: [SOURCE_ITEM_ID],
      quantityTransfers: [{
        itemId: SOURCE_ITEM_ID,
        sourceLocalGroupId: GROUP_ID,
        sourceVersion: 7,
        quantity,
      }],
      comment: null,
    });
  });

  it("shows an administrator's accepted whole-group assignment against the selected local row", async () => {
    const onComplete = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ result: {
        total: 1,
        included: 1,
        problems: 0,
        items: [{ itemId: SOURCE_ITEM_ID, outcome: "included", requestItemId: GROUP_ID, requestItemVersion: 1 }],
        request: {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          items: [{ item: { id: SOURCE_ITEM_ID }, result: "accepted", invalidReason: null }],
        },
      } }),
    } as Response);
    renderBulk(localGroup(5), "admin", onComplete);
    openIssueDialog();
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.submitAssignment" }));
    await screen.findByText("tmc.bulk.success");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Local chair group")).toHaveLength(2);
    expect(screen.queryByText(SOURCE_ITEM_ID)).toBeNull();
    expect(screen.queryByText("Current owner")).toBeNull();
    expect(screen.getByText("Previous responsible")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/inventory/transfer-requests");
  });

  it("moves a mixed selection without splitting the original item's quantity", async () => {
    const originalId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const original = {
      ...localGroup(20),
      id: originalId,
      sourceItemId: undefined,
      localGroupId: undefined,
      inventoryNumber: "ORIGINAL-20",
      name: "Original chair stock",
      version: 3,
    } satisfies InventoryItem;
    vi.mocked(fetch).mockResolvedValue(problemResponse([originalId, SOURCE_ITEM_ID]));
    renderBulk([original, localGroup(5)]);
    openIssueDialog();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "choose-recipient" }));
    fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.submitTransfer" }));
    await waitFor(() => expect(screen.getAllByText("tmc.problem.active_transfer_exists")).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/inventory/transfer-requests");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: [originalId, SOURCE_ITEM_ID],
      quantityTransfers: [{
        itemId: SOURCE_ITEM_ID,
        sourceLocalGroupId: GROUP_ID,
        sourceVersion: 7,
        quantity: 5,
      }],
      comment: null,
    });
  });
});

function renderBulk(item: InventoryItem | InventoryItem[], actorRole: "admin" | "employee" = "employee", onComplete = vi.fn()) {
  render(
    <TmcBulkActions
      items={Array.isArray(item) ? item : [item]}
      actorUserId={OWNER_ID}
      actorRole={actorRole}
      variant="issue"
      buildings={[]}
      rooms={[]}
      onComplete={onComplete}
    />,
  );
}

function openIssueDialog() {
  fireEvent.click(screen.getByRole("button", { name: "tmc.bulk.actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "tmc.operation.issue" }));
}

function problemResponse(itemIds: string[]): Response {
  return {
    ok: true,
    json: async () => ({ result: {
      request: null,
      total: itemIds.length,
      included: 0,
      problems: itemIds.length,
      items: itemIds.map((itemId) => ({ itemId, outcome: "problem", problem: "active_transfer_exists" })),
    } }),
  } as Response;
}
