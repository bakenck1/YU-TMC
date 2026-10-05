import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InventoryItemComposition from "@/components/InventoryItemComposition";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";

const { refresh, translate } = vi.hoisted(() => ({
  refresh: vi.fn(),
  translate: (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.values(params).join(" ")}` : key,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: translate }),
}));

const MONITOR: InventoryItemDto = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "Monitor",
  description: null,
  itemType: "electronics",
  brand: "BenQ",
  model: null,
  quantity: 1,
  unitPrice: 1000,
  inventoryNumberKind: "official",
  inventoryNumber: "INV-001",
  room: {
    id: "55555555-5555-4555-8555-555555555555",
    designation: "201A",
    floorNumber: 2,
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Main campus",
  },
  status: "active",
  qrCode: null,
  responsible: null,
  photoUrl: null,
  version: 1,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  archivedAt: null,
};
const CHAIR: InventoryItemDto = {
  ...MONITOR,
  id: "88888888-8888-4888-8888-888888888888",
  name: "Chair",
  itemType: "furniture",
  brand: null,
  inventoryNumber: "INV-002",
};

const fetchMock = vi.fn<typeof fetch>();

function postCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

async function openPicker() {
  render(
    <InventoryItemComposition
      itemId={LOCAL_PART.itemId}
      initialComponents={[]}
      canManage
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "itemComposition.add" }));
  await screen.findByRole("checkbox", { name: /Monitor/ });
  return within(screen.getByRole("dialog"));
}

const LOCAL_PART: LocalBarcodeGroupDto = {
  id: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  itemName: "Стул",
  originalBarcode: "4587/8486",
  itemType: "furniture",
  brand: null,
  model: null,
  description: null,
  unitPrice: 1000,
  photoUrl: null,
  localBarcode: "4587/8486-0001",
  parentGroupId: null,
  quantity: 5,
  responsible: { id: "33333333-3333-4333-8333-333333333333", fullName: "Сотрудник Б" },
  previousResponsible: { id: "44444444-4444-4444-8444-444444444444", fullName: "Сотрудник А" },
  location: {
    roomId: "55555555-5555-4555-8555-555555555555",
    roomDesignation: "201A",
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Главный корпус",
  },
  transferredAt: "2026-09-01T10:00:00.000Z",
  status: "active",
  version: 1,
  cancellation: null,
};

describe("InventoryItemComposition", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? Response.json({ components: [MONITOR, CHAIR] })
        : Response.json({ candidates: [MONITOR, CHAIR] }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows transferred local parts as automatically linked related items", () => {
    render(
      <InventoryItemComposition
        itemId={LOCAL_PART.itemId}
        initialComponents={[]}
        localGroups={[LOCAL_PART]}
        canManage={false}
      />,
    );

    expect(screen.getByText("Локальные части")).toBeTruthy();
    expect(screen.getByText("Части, переданные из этой ТМЦ, связываются автоматически.")).toBeTruthy();
    expect(screen.getByText(LOCAL_PART.localBarcode)).toBeTruthy();
    expect(screen.getByText("Количество: 5 · Сотрудник Б")).toBeTruthy();
    expect(screen.getByRole("link", { name: /4587\/8486-0001/ }).getAttribute("href"))
      .toBe(`/local-barcodes/${LOCAL_PART.id}`);
  });

  it("adds multiple checked items in one request and updates the linked list", async () => {
    const dialog = await openPicker();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    fireEvent.click(await dialog.findByRole("checkbox", { name: /Chair/ }));

    expect((dialog.getByRole("checkbox", { name: /Monitor/ }) as HTMLInputElement).checked).toBe(true);
    expect((dialog.getByRole("checkbox", { name: /Chair/ }) as HTMLInputElement).checked).toBe(true);
    expect(dialog.getByRole("status").textContent).toContain("itemComposition.selectedCount 2");

    fireEvent.click(dialog.getByRole("button", { name: /itemComposition.confirm/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0]?.[0]).toBe(`/api/inventory/items/${LOCAL_PART.itemId}/components`);
    expect(JSON.parse(String(postCalls()[0]?.[1]?.body))).toEqual({
      componentIds: [MONITOR.id, CHAIR.id],
    });
    expect(screen.getByRole("link", { name: /Monitor/ }).getAttribute("href"))
      .toBe(`/items/${MONITOR.id}`);
    expect(screen.getByRole("link", { name: /Chair/ }).getAttribute("href"))
      .toBe(`/items/${CHAIR.id}`);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("preserves checked items and the selection count while searching other results", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === "POST") return Response.json({ components: [MONITOR, CHAIR] });
      const query = new URL(String(url), "http://localhost").searchParams.get("q");
      return Response.json({ candidates: query === "Chair" ? [CHAIR] : [MONITOR, CHAIR] });
    });
    const dialog = await openPicker();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    fireEvent.change(dialog.getByRole("textbox", { name: "common.search" }), {
      target: { value: "Chair" },
    });
    await waitFor(() => expect(dialog.queryByRole("checkbox", { name: /Monitor/ })).toBeNull());
    fireEvent.click(await dialog.findByRole("checkbox", { name: /Chair/ }));
    expect(dialog.getByRole("status").textContent).toContain("itemComposition.selectedCount 2");

    fireEvent.change(dialog.getByRole("textbox", { name: "common.search" }), {
      target: { value: "" },
    });
    await screen.findByRole("checkbox", { name: /Monitor/ });
    expect((dialog.getByRole("checkbox", { name: /Monitor/ }) as HTMLInputElement).checked).toBe(true);
    expect((dialog.getByRole("checkbox", { name: /Chair/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(dialog.getByRole("button", { name: /itemComposition.confirm/ }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(JSON.parse(String(postCalls()[0]?.[1]?.body))).toEqual({
      componentIds: [MONITOR.id, CHAIR.id],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("supports deselection by checkbox and selected chip without submitting an empty selection", async () => {
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(String(url), "http://localhost").searchParams.get("q");
      return Response.json({ candidates: query === "Monitor" ? [MONITOR] : [MONITOR, CHAIR] });
    });
    const dialog = await openPicker();
    const confirm = dialog.getByRole("button", { name: /itemComposition.confirm/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(postCalls()).toHaveLength(0);

    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Chair/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    expect(dialog.getByRole("status").textContent).toContain("itemComposition.selectedCount 1");
    expect((dialog.getByRole("checkbox", { name: /Monitor/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(dialog.getByRole("textbox", { name: "common.search" }), {
      target: { value: "Monitor" },
    });
    await waitFor(() => expect(dialog.queryByRole("checkbox", { name: /Chair/ })).toBeNull());
    await dialog.findByRole("checkbox", { name: /Monitor/ });
    fireEvent.click(dialog.getByRole("button", { name: "itemComposition.deselect Chair" }));
    expect(dialog.getByRole("status").textContent).toContain("itemComposition.selectedCount 0");
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(postCalls()).toHaveLength(0);
  });

  it("disables selection, search, close and duplicate submissions while the batch saves", async () => {
    let finishSave!: (response: Response) => void;
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => { finishSave = resolve; })
        : Response.json({ candidates: [MONITOR, CHAIR] }),
    );
    const dialog = await openPicker();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Chair/ }));
    fireEvent.click(dialog.getByRole("button", { name: /itemComposition.confirm/ }));

    for (const control of [
      ...dialog.getAllByRole("button"),
      ...dialog.getAllByRole("checkbox"),
      dialog.getByRole("textbox", { name: "common.search" }),
    ]) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    }
    const modal = screen.getByRole("dialog");
    expect(modal.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(modal);
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(modal, tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(modal);
    }
    fireEvent.keyDown(modal, { key: "Escape" });
    fireEvent.click(dialog.getByRole("button", { name: "itemDetails.saving" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(postCalls()).toHaveLength(1);

    await act(async () => finishSave(Response.json({ components: [MONITOR, CHAIR] })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps selections after a failed batch so the same items can be retried", async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return Response.json({ candidates: [MONITOR, CHAIR] });
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: "item_components_unavailable" }, { status: 409 })
        : Response.json({ components: [MONITOR, CHAIR] });
    });
    const dialog = await openPicker();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Monitor/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Chair/ }));
    fireEvent.click(dialog.getByRole("button", { name: /itemComposition.confirm/ }));

    await screen.findByRole("alert");
    expect(dialog.getByRole("alert").textContent).toBe("itemComposition.error");
    expect((dialog.getByRole("checkbox", { name: /Monitor/ }) as HTMLInputElement).checked).toBe(true);
    expect((dialog.getByRole("checkbox", { name: /Chair/ }) as HTMLInputElement).checked).toBe(true);
    expect(dialog.getByRole("status").textContent).toContain("itemComposition.selectedCount 2");
    expect(refresh).not.toHaveBeenCalled();

    const modal = screen.getByRole("dialog");
    expect(document.activeElement).toBe(modal);
    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(modal, shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: /itemComposition.confirm/ }));

    fireEvent.click(dialog.getByRole("button", { name: /itemComposition.confirm/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(postCalls()).toHaveLength(2);
    expect(postCalls().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { componentIds: [MONITOR.id, CHAIR.id] },
      { componentIds: [MONITOR.id, CHAIR.id] },
    ]);
  });
});
