import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import QrScanPage from "@/components/QrScanPage";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/InventoryItemCodeScanner", () => ({
  default: ({ onCodeSelected }: { onCodeSelected(value: string): void }) => (
    <button type="button" onClick={() => onCodeSelected("INV-42")}>resolve barcode</button>
  ),
}));
vi.mock("@/components/InventoryRoomQrScanner", () => ({
  default: () => <div>room scanner</div>,
}));
vi.mock("@/components/ScannedItemDetailsCard", () => ({
  default: ({ item, actions }: { item: { status: string; responsibleName?: string | null; itemDetails?: { condition: string; photoUrl: string | null } }; actions?: ReactNode }) => (
    <div>
      <span>{item.status}</span>
      <span>{item.responsibleName}</span>
      <span>{item.itemDetails?.condition}</span>
      <span>{item.itemDetails?.photoUrl}</span>
      {actions}
    </div>
  ),
}));
vi.mock("@/lib/contracts/tmc-operations", () => ({
  parseCreateTmcTransferRequestResult: () => ({
    request: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    items: [{
      itemId: "33333333-3333-4333-8333-333333333333",
      outcome: "included",
    }],
  }),
}));

describe("QrScanPage", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          resolution: {
            status: "resolved",
            canonicalKey: "INV-42",
            format: "legacy_raw",
            qrStatus: "active",
            target: {
              kind: "item",
              id: "33333333-3333-4333-8333-333333333333",
              status: "active",
              title: "Laptop",
              inventoryNumber: "INV-42",
              responsibleName: "Current owner",
              responsibleId: "22222222-2222-4222-8222-222222222222",
              isAssigned: true,
              isCurrentUserResponsible: false,
              itemDetails: {
                itemType: "electronics",
                brand: "Dell",
                model: "Latitude",
                description: "Office laptop",
                quantity: 1,
                unitPrice: 350000,
                condition: "good",
                connectionStatus: "connected",
                photoUrl: "/api/inventory/qr/item-photo?value=INV-42&kind=barcode",
                createdAt: "2026-08-01T00:00:00.000Z",
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: {} }),
      }));
  });

  it("keeps a foreign scanned item on the scan page and requests transfer to the employee", async () => {
    render(
      <QrScanPage
        actorRole="employee"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "scanner.itemTitle" }));
    fireEvent.click(screen.getByRole("button", { name: "resolve barcode" }));

    expect(await screen.findByText("Current owner")).not.toBeNull();
    expect(screen.getByText("good")).not.toBeNull();
    expect(screen.getByText(/item-photo/)).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/inventory/qr/resolve?value=INV-42&kind=barcode&target=item",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "tmc.operation.requestTransfer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = vi.mocked(fetch).mock.calls[1];
    expect(request?.[0]).toBe("/api/inventory/transfer-requests");
    const init = request?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: ["33333333-3333-4333-8333-333333333333"],
      requestKind: "claim",
    });
    expect(init.headers).toEqual(expect.objectContaining({
      "idempotency-key": "scan-transfer:00000000-0000-4000-8000-000000000001",
    }));
    expect(await screen.findByRole("link", { name: "tmc.operation.requestSuccess" })).not.toBeNull();
  });

  it("shows a scanned maintenance item without offering responsibility actions", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        resolution: {
          status: "resolved",
          canonicalKey: "INV-42",
          format: "legacy_raw",
          qrStatus: "active",
          target: {
            kind: "item",
            id: "33333333-3333-4333-8333-333333333333",
            status: "maintenance",
            title: "Laptop",
            inventoryNumber: "INV-42",
            responsibleName: "Current owner",
            responsibleId: "22222222-2222-4222-8222-222222222222",
            isAssigned: true,
            isCurrentUserResponsible: false,
          },
        },
      }),
    } as Response);

    render(<QrScanPage actorRole="employee" />);
    fireEvent.click(screen.getByRole("button", { name: "scanner.itemTitle" }));
    fireEvent.click(screen.getByRole("button", { name: "resolve barcode" }));

    expect(await screen.findByText("maintenance")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "tmc.operation.requestTransfer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "tmc.operation.acceptItem" })).toBeNull();
  });
});
