import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TmcTransferRequestCard from "@/components/TmcTransferRequestCard";
import {
  parseTmcTransferRequest,
  type TmcTransferRequestDto,
  type TmcTransferRequestItemDto,
} from "@/lib/contracts/tmc-operations";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ language: "en", t: (key: string) => key }),
}));

const request = (): TmcTransferRequestDto => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  initiator: user("11111111-1111-4111-8111-111111111111"), recipient: user("22222222-2222-4222-8222-222222222222"),
  comment: null, createdAt: "2026-08-10T00:00:00.000Z", expiresAt: "2026-08-11T00:00:00.000Z", overdue: false, version: 1,
  status: "pending", closedAt: null, closedBy: null, isAdministrativeDecision: false, administrativeReason: null,
  summary: { total: 2, pending: 2, accepted: 0, rejected: 0, cancelled: 0, invalidated: 0 },
  items: [item(1), item(2)],
});
const user = (id: string) => ({ id, fullName: `User ${id}`, email: `${id}@example.test`, role: "employee" as const });
const item = (number: number): TmcTransferRequestItemDto => ({
  id: `55555555-5555-4555-8555-${String(number).padStart(12, "0")}`,
  requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  item: {
    id: `33333333-3333-4333-8333-${String(number).padStart(12, "0")}`,
    name: `Item ${number}`,
    inventoryNumber: `INV-${number}`,
    quantity: 1,
    unitPrice: 10,
    photoUrl: null,
    location: {
      buildingId: "66666666-6666-4666-8666-666666666666",
      buildingName: "A",
      roomId: "77777777-7777-4777-8777-777777777777",
      roomDesignation: "1",
    },
  },
  responsibilityPeriodIdAtRequest: "44444444-4444-4444-8444-444444444444",
  currentResponsibleIdAtRequest: "11111111-1111-4111-8111-111111111111",
  responsibleUserProfile: user("11111111-1111-4111-8111-111111111111"),
  createdAt: "2026-08-10T00:00:00.000Z",
  result: "pending" as const,
  invalidReason: null,
  decidedAt: null,
  decidedBy: null,
  version: 1,
});

function acceptedRequest(): TmcTransferRequestDto {
  const base = request();
  const decidedAt = "2026-08-10T01:00:00.000Z";
  return {
    ...base,
    status: "accepted",
    closedAt: decidedAt,
    closedBy: user("22222222-2222-4222-8222-222222222222"),
    items: base.items.map((row, index) => terminalItem(row, index === 0 ? "accepted" : "rejected", decidedAt)),
    summary: { total: 2, pending: 0, accepted: 1, rejected: 1, cancelled: 0, invalidated: 0 },
  };
}

function terminalItem(
  row: TmcTransferRequestItemDto,
  result: "accepted" | "rejected",
  decidedAt: string,
): TmcTransferRequestItemDto {
  return {
    ...row,
    result,
    invalidReason: null,
    decidedAt,
    decidedBy: user("22222222-2222-4222-8222-222222222222"),
  };
}

describe("TmcTransferRequestCard", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request: acceptedRequest() }) }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("crypto", { randomUUID: () => "attempt" });
  });

  it("submits explicit accept/reject decisions for current pending rows only and prevents double click", async () => {
    expect(() => parseTmcTransferRequest(acceptedRequest())).not.toThrow();
    render(<TmcTransferRequestCard request={request()} canDecide showOverdue={false} requiresAdministrativeReason={false} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);
    const button = screen.getByRole("button", { name: "tmc.request.acceptSelected" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "idempotency-key": "tmc-decision:attempt" });
    expect(JSON.parse(String(init.body)).decisions.map((decision: { decision: string }) => decision.decision)).toEqual(["accept", "reject"]);
    await screen.findByRole("status");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("requires and focuses an administrative reason before it can submit", () => {
    render(<TmcTransferRequestCard request={request()} canDecide showOverdue={false} requiresAdministrativeReason />);
    fireEvent.click(screen.getByRole("button", { name: "tmc.request.acceptAll" }));
    const reason = screen.getByRole("textbox");
    expect(document.activeElement).toBe(reason);
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("submits only pending rows and retains the logical idempotency attempt after an uncertain server failure", async () => {
    const mixed = request();
    mixed.items[1] = terminalItem(
      mixed.items[1]!,
      "accepted",
      "2026-08-10T01:00:00.000Z",
    );
    mixed.summary = { total: 2, pending: 1, accepted: 1, rejected: 0, cancelled: 0, invalidated: 0 };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "decision_failed" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ request: acceptedRequest() }) }));
    const randomUUID = vi.fn(() => "persistent-attempt");
    vi.stubGlobal("crypto", { randomUUID });
    render(<TmcTransferRequestCard request={mixed} canDecide showOverdue={false} requiresAdministrativeReason={false} />);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[0]?.disabled).toBe(false);
    expect(checkboxes[1]?.disabled).toBe(true);
    const acceptAll = screen.getByRole("button", { name: "tmc.request.acceptAll" });
    fireEvent.click(acceptAll);
    await screen.findByRole("alert");
    fireEvent.click(acceptAll);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).headers;
    const secondHeaders = (vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit).headers;
    expect(firstHeaders).toMatchObject({ "idempotency-key": "tmc-decision:persistent-attempt" });
    expect(secondHeaders).toEqual(firstHeaders);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body)).decisions).toHaveLength(1);
  });

  it("refreshes stale decisions and aborts an in-flight request when unmounted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "version_conflict" }),
    }));
    const stale = render(<TmcTransferRequestCard request={request()} canDecide showOverdue={false} requiresAdministrativeReason={false} />);
    fireEvent.click(screen.getByRole("button", { name: "tmc.request.acceptAll" }));
    await screen.findByRole("alert");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/inventory/transfer-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/decision",
      expect.anything(),
    );
    const staleInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(staleInit.credentials).toBe("same-origin");
    expect(staleInit.cache).toBe("no-store");
    expect(staleInit.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(staleInit.body))).toMatchObject({
      requestVersion: 1,
      decisions: [
        { itemId: "33333333-3333-4333-8333-000000000001", itemVersion: 1, decision: "accept" },
        { itemId: "33333333-3333-4333-8333-000000000002", itemVersion: 1, decision: "accept" },
      ],
    });
    stale.unmount();

    let pendingInit!: RequestInit;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_, init) => {
      pendingInit = init as RequestInit;
      return new Promise(() => undefined);
    }));
    const pending = render(<TmcTransferRequestCard request={request()} canDecide showOverdue={false} requiresAdministrativeReason={false} />);
    fireEvent.click(screen.getByRole("button", { name: "tmc.request.acceptAll" }));
    await waitFor(() => expect(pendingInit.signal?.aborted).toBe(false));
    pending.unmount();
    expect(pendingInit.signal?.aborted).toBe(true);
  });
});
