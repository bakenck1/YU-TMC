import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TmcItemQrFlow from "@/components/TmcItemQrFlow";
import { parseCreateTmcTransferRequestResult } from "@/lib/contracts/tmc-operations";
import { TMC_OPERATION_BY_ID } from "@/lib/tmc-navigation";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/InventoryItemCodeScanner", () => ({
  default: ({ onClose, onCodeSelected }: { onClose(): void; onCodeSelected(value: string): void }) => (
    <div data-testid="scanner"><button onClick={() => onCodeSelected("qr-1")}>resolve code</button><button onClick={onClose}>close scanner</button></div>
  ),
}));
vi.mock("@/components/TmcUserPicker", () => ({
  default: ({ onChange }: { onChange(user: { id: string; fullName: string; email: string; role: "employee" }): void }) => (
    <button type="button" data-testid="recipient-picker" onClick={() => onChange({ id: "22222222-2222-4222-8222-222222222222", fullName: "New owner", email: "new@example.test", role: "employee" })}>
      select recipient
    </button>
  ),
}));

describe("TmcItemQrFlow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("resolves an item after scan, targets item QR scope, and offers a picker only for issue/transfer", async () => {
    vi.mocked(fetch).mockResolvedValue(responseForItem());
    const { rerender } = render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.issue} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    expect(screen.getByRole("status").textContent).toContain("tmc.qr.resolving");
    await screen.findByRole("heading", { name: "Laptop" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/inventory/qr/resolve?value=qr-1&kind=qr&target=item",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
    expect(screen.getByTestId("recipient-picker")).not.toBeNull();

    rerender(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} />);
    expect(screen.queryByTestId("recipient-picker")).toBeNull();
  });

  it("returns focus to Scan after close and lets an error be retried", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.transfer} />);
    fireEvent.click(screen.getByRole("button", { name: "close scanner" }));
    const scan = screen.getByRole("button", { name: "tmc.qr.scan" });
    await waitFor(() => expect(document.activeElement).toBe(scan));
    fireEvent.click(scan);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "tmc.qr.scanAgain" }));
    expect(screen.getByTestId("scanner")).not.toBeNull();
  });

  it("submits a free-item acceptance or a one-item transfer request only after the selected item is confirmed", async () => {
    expect(() => parseCreateTmcTransferRequestResult(createdRequestResult())).not.toThrow();
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ responsibility: {} }) } as Response);
    const receive = render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    fireEvent.click(screen.getByRole("button", { name: "tmc.operation.acceptItem" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/inventory/items/33333333-3333-4333-8333-333333333333/responsibility/accept",
      expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
    ));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("tmc.operation.receiveSuccess"));

    receive.unmount();
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockResolvedValueOnce(createdRequestResponse());
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.issue} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    fireEvent.click(screen.getByTestId("recipient-picker"));
    fireEvent.change(screen.getByRole("textbox", { name: "tmc.operation.comment" }), { target: { value: "Hand over" } });
    fireEvent.click(screen.getByRole("button", { name: "tmc.operation.sendRequest" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/inventory/transfer-requests",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json", "idempotency-key": expect.any(String) }),
      }),
    ));
    const transferInit = vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(transferInit.body))).toEqual({
      recipientId: "22222222-2222-4222-8222-222222222222",
      itemIds: ["33333333-3333-4333-8333-333333333333"],
      comment: "Hand over",
    });
    expect((await screen.findByRole("link", { name: "tmc.operation.requestSuccess" })).getAttribute("href"))
      .toBe("/tmc/transfer-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("coalesces a double confirmation and aborts its receive request when the selected item is reset", async () => {
    let resolveAcceptance!: (value: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockImplementationOnce((_, init) => new Promise((resolve) => {
        resolveAcceptance = resolve;
        expect((init as RequestInit).signal?.aborted).toBe(false);
      }));
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    const confirm = screen.getByRole("button", { name: "tmc.operation.acceptItem" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const acceptanceInit = vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit;
    fireEvent.click(screen.getByRole("button", { name: "tmc.qr.scanAgain" }));
    expect(acceptanceInit.signal?.aborted).toBe(true);
    resolveAcceptance({ ok: true, json: async () => ({}) } as Response);
    await Promise.resolve();
    expect(screen.queryByText("tmc.operation.receiveSuccess")).toBeNull();
  });

  it("reconciles a re-scan that reports the item as already assigned to the current user without another POST", async () => {
    vi.mocked(fetch).mockResolvedValue(responseForItem({
      isCurrentUserResponsible: true,
      responsibleName: "You",
    }));
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    expect(screen.queryByRole("button", { name: "tmc.operation.acceptItem" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("tmc.operation.receiveSuccess");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send a receive command for an item owned by another user", async () => {
    vi.mocked(fetch).mockResolvedValue(responseForItem({ responsibleName: "Other owner" }));
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.receive} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    expect(screen.queryByRole("button", { name: "tmc.operation.acceptItem" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("tmc.operation.receiveUnavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries uncertain transfer creation with one key but replaces it after a deterministic all-problem result", async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    vi.stubGlobal("crypto", { randomUUID });
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "unavailable" }) } as Response)
      .mockResolvedValueOnce(createdRequestResponse());
    const transfer = render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.transfer} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    fireEvent.click(screen.getByTestId("recipient-picker"));
    const send = screen.getByRole("button", { name: "tmc.operation.sendRequest" });
    fireEvent.click(send);
    await screen.findByRole("alert");
    fireEvent.click(send);
    await screen.findByRole("link", { name: "tmc.operation.requestSuccess" });
    const uncertainHeaders = (vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).headers;
    const retryHeaders = (vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit).headers;
    expect(retryHeaders).toEqual(uncertainHeaders);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    transfer.unmount();

    const freshRandomUuid = vi.fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000004");
    vi.stubGlobal("crypto", { randomUUID: freshRandomUuid });
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockResolvedValueOnce(allProblemResponse())
      .mockResolvedValueOnce(createdRequestResponse());
    const fresh = render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.issue} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    fireEvent.click(screen.getByTestId("recipient-picker"));
    const freshSend = screen.getByRole("button", { name: "tmc.operation.sendRequest" });
    fireEvent.click(freshSend);
    await screen.findByRole("alert");
    fireEvent.click(freshSend);
    await screen.findByRole("link", { name: "tmc.operation.requestSuccess" });
    const rejectedHeaders = (vi.mocked(fetch).mock.calls[4]?.[1] as RequestInit).headers;
    const renewedHeaders = (vi.mocked(fetch).mock.calls[5]?.[1] as RequestInit).headers;
    expect(rejectedHeaders).not.toEqual(renewedHeaders);
    expect(freshRandomUuid).toHaveBeenCalledTimes(2);
    fresh.unmount();
  });

  it("keeps the idempotency key while the server reports that the same create command is still in progress", async () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000005");
    vi.stubGlobal("crypto", { randomUUID });
    vi.mocked(fetch)
      .mockResolvedValueOnce(responseForItem())
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "idempotency_request_in_progress" }),
      } as Response)
      .mockResolvedValueOnce(createdRequestResponse());
    render(<TmcItemQrFlow operation={TMC_OPERATION_BY_ID.issue} />);
    fireEvent.click(screen.getByRole("button", { name: "resolve code" }));
    await screen.findByRole("heading", { name: "Laptop" });
    fireEvent.click(screen.getByTestId("recipient-picker"));
    const send = screen.getByRole("button", { name: "tmc.operation.sendRequest" });
    fireEvent.click(send);
    await screen.findByRole("alert");
    fireEvent.click(send);
    await screen.findByRole("link", { name: "tmc.operation.requestSuccess" });
    const firstHeaders = (vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).headers;
    const retryHeaders = (vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit).headers;
    expect(retryHeaders).toEqual(firstHeaders);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});

function responseForItem({
  isCurrentUserResponsible = false,
  responsibleName = null,
}: {
  isCurrentUserResponsible?: boolean;
  responsibleName?: string | null;
} = {}) {
  return {
    ok: true,
    json: async () => ({
      resolution: {
        status: "resolved", canonicalKey: "qr-1", format: "generated_v1", qrStatus: "active",
        target: { kind: "item", id: "33333333-3333-4333-8333-333333333333", status: "active", title: "Laptop", inventoryNumber: "INV-1", buildingName: "A", roomDesignation: "101", responsibleName, isCurrentUserResponsible },
      },
    }),
  } as Response;
}

function createdRequestResponse() {
  return {
    ok: true,
    json: async () => ({ result: createdRequestResult() }),
  } as Response;
}

function createdRequestResult() {
  return {
        request: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          initiator: operationUser("11111111-1111-4111-8111-111111111111", "Initiator"),
          recipient: operationUser("22222222-2222-4222-8222-222222222222", "New owner"),
          status: "pending",
          comment: "Hand over",
          createdAt: "2026-08-10T00:00:00.000Z",
          expiresAt: "2026-08-11T00:00:00.000Z",
          overdue: false,
          closedAt: null,
          closedBy: null,
          isAdministrativeDecision: false,
          administrativeReason: null,
          version: 1,
          summary: { total: 1, pending: 1, accepted: 0, rejected: 0, cancelled: 0, invalidated: 0 },
          items: [{
            id: "55555555-5555-4555-8555-555555555555",
            requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            item: {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Laptop",
              inventoryNumber: "INV-1",
              quantity: 1,
              unitPrice: 1,
              photoUrl: null,
              location: {
                buildingId: "66666666-6666-4666-8666-666666666666",
                buildingName: "A",
                roomId: "77777777-7777-4777-8777-777777777777",
                roomDesignation: "101",
              },
            },
            responsibilityPeriodIdAtRequest: "88888888-8888-4888-8888-888888888888",
            currentResponsibleIdAtRequest: "11111111-1111-4111-8111-111111111111",
            responsibleUserProfile: operationUser("11111111-1111-4111-8111-111111111111", "Initiator"),
            result: "pending",
            invalidReason: null,
            createdAt: "2026-08-10T00:00:00.000Z",
            decidedAt: null,
            decidedBy: null,
            version: 1,
          }],
        },
        total: 1,
        included: 1,
        problems: 0,
        items: [{
          itemId: "33333333-3333-4333-8333-333333333333",
          outcome: "included",
          requestItemId: "55555555-5555-4555-8555-555555555555",
          requestItemVersion: 1,
        }],
  };
}

function operationUser(id: string, fullName: string) {
  return { id, fullName, email: `${id}@example.test`, role: "employee" };
}

function allProblemResponse() {
  return {
    ok: true,
    json: async () => ({
      result: {
        request: null,
        total: 1,
        included: 0,
        problems: 1,
        items: [{
          itemId: "33333333-3333-4333-8333-333333333333",
          outcome: "problem",
          problem: "item_unassigned",
        }],
      },
    }),
  } as Response;
}
