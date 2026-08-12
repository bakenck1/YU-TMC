import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TmcHistory from "@/components/TmcHistory";
import TmcNotifications from "@/components/TmcNotifications";
import type { TmcLocationHistoryDto, TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ language: "en", t: (key: string) => key }),
}));

const REQUEST: TmcTransferRequestDto = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  initiator: { id: "11111111-1111-4111-8111-111111111111", fullName: "Initiator", email: "i@example.test", role: "employee" },
  recipient: { id: "22222222-2222-4222-8222-222222222222", fullName: "Recipient", email: "r@example.test", role: "employee" },
  status: "pending", comment: null, createdAt: "2026-08-10T00:00:00.000Z",
  expiresAt: "2026-08-11T00:00:00.000Z", overdue: true, version: 1,
  closedAt: null, closedBy: null, isAdministrativeDecision: false, administrativeReason: null,
  summary: { total: 1, pending: 1, accepted: 0, rejected: 0, cancelled: 0, invalidated: 0 },
  items: [{
    id: "33333333-3333-4333-8333-333333333333", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    item: { id: "44444444-4444-4444-8444-444444444444", name: "Laptop", inventoryNumber: "INV-1", quantity: 1, unitPrice: 10, photoUrl: null, location: { buildingId: "55555555-5555-4555-8555-555555555555", buildingName: "A", roomId: "66666666-6666-4666-8666-666666666666", roomDesignation: "101" } },
    responsibilityPeriodIdAtRequest: "77777777-7777-4777-8777-777777777777", currentResponsibleIdAtRequest: "11111111-1111-4111-8111-111111111111",
    responsibleUserProfile: { id: "11111111-1111-4111-8111-111111111111", fullName: "Initiator", email: "i@example.test", role: "employee" },
    createdAt: "2026-08-10T00:00:00.000Z", result: "pending", invalidReason: null, decidedAt: null, decidedBy: null, version: 1,
  }],
};
const LOCATION_CHANGE: TmcLocationHistoryDto = {
  id: "88888888-8888-4888-8888-888888888888",
  itemId: REQUEST.items[0]!.item.id,
  itemName: "Laptop",
  inventoryNumber: "INV-1",
  actorId: "99999999-9999-4999-8999-999999999999",
  actorName: "Administrator",
  beforeRoomId: "66666666-6666-4666-8666-666666666666",
  beforeLocation: "Building A / 101",
  afterRoomId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  afterLocation: "Building B / 202",
  comment: "Move to laboratory",
  occurredAt: "2026-08-10T01:00:00.000Z",
};

describe("TMC stage four UI", () => {
  beforeEach(() => { push.mockReset(); vi.stubGlobal("fetch", vi.fn()); });

  it("renders server-backed history filters and overdue results", () => {
    render(<TmcHistory requests={[REQUEST]} locationChanges={[LOCATION_CHANGE]} nextRequestHref="/tmc/history?requestCursor=next" nextLocationHref="/tmc/history?locationCursor=next" />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("Initiator → Recipient")).not.toBeNull();
    expect(screen.getByText("tmc.request.overdue")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Initiator/ }).getAttribute("href")).toBe(`/tmc/transfer-requests/${REQUEST.id}`);
    expect(screen.getByText("Building A / 101 → Building B / 202")).not.toBeNull();
    expect(screen.getByText(/Move to laboratory/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "tmc.history.loadOlderRequests" }).getAttribute("href")).toContain("requestCursor=next");
    expect(screen.getByRole("link", { name: "tmc.history.loadOlderLocations" }).getAttribute("href")).toContain("locationCursor=next");
  });

  it("shows unread count and exposes each notification as a request link with persisted read state", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 1, notifications: [{ id: "99999999-9999-4999-8999-999999999999", type: "tmc_transfer.requested", requestId: REQUEST.id, itemId: null, safePayload: {}, occurredAt: REQUEST.createdAt, readAt: null }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    render(<TmcNotifications />);
    await waitFor(() => expect(screen.getByLabelText("tmc.notifications.unread").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /tmc.notifications.title/ }));
    const notification = screen.getByRole("link", { name: /tmc.notifications.requested/ });
    expect(notification.getAttribute("href")).toBe(`/tmc/transfer-requests/${REQUEST.id}`);
    notification.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(notification);
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/inventory/notifications/99999999-9999-4999-8999-999999999999/read",
      { method: "POST", credentials: "same-origin", cache: "no-store" },
    ));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/tmc/transfer-requests/${REQUEST.id}`));
  });

  it("labels notifications already persisted as read", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 0, notifications: [{ id: "99999999-9999-4999-8999-999999999999", type: "tmc_transfer.requested", requestId: REQUEST.id, itemId: null, safePayload: {}, occurredAt: REQUEST.createdAt, readAt: "2026-08-10T01:00:00.000Z" }] }) } as Response);
    render(<TmcNotifications />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "tmc.notifications.title" }));
    expect(screen.getByText("tmc.notifications.read")).not.toBeNull();
  });

  it("still opens the request if persisting the read receipt fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 1, notifications: [{ id: "99999999-9999-4999-8999-999999999999", type: "tmc_transfer.requested", requestId: REQUEST.id, itemId: null, safePayload: {}, occurredAt: REQUEST.createdAt, readAt: null }] }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    render(<TmcNotifications />);
    await waitFor(() => expect(screen.getByLabelText("tmc.notifications.unread")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /tmc.notifications.title/ }));
    const notification = screen.getByRole("link", { name: /tmc.notifications.requested/ });
    notification.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(notification);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/tmc/transfer-requests/${REQUEST.id}`));
  });

  it("guards a notification from duplicate read requests and navigation", async () => {
    let resolveRead!: (response: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 1, notifications: [{ id: "99999999-9999-4999-8999-999999999999", type: "tmc_transfer.requested", requestId: REQUEST.id, itemId: null, safePayload: {}, occurredAt: REQUEST.createdAt, readAt: null }] }) } as Response)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRead = resolve; }));
    render(<TmcNotifications />);
    await waitFor(() => expect(screen.getByLabelText("tmc.notifications.unread")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /tmc.notifications.title/ }));
    const notification = screen.getByRole("link", { name: /tmc.notifications.requested/ });
    notification.addEventListener("click", (event) => event.preventDefault());

    fireEvent.click(notification);
    fireEvent.click(notification);

    expect(vi.mocked(fetch).mock.calls.filter(([url]) =>
      String(url).endsWith("/read"),
    )).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();

    resolveRead({ ok: true, status: 204 } as Response);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(`/tmc/transfer-requests/${REQUEST.id}`);
  });

  it("aborts notification polling when the component unmounts", async () => {
    let pollingSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      pollingSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const view = render(<TmcNotifications />);
    await waitFor(() => expect(pollingSignal).toBeInstanceOf(AbortSignal));

    view.unmount();

    expect(pollingSignal?.aborted).toBe(true);
  });

  it("uses outcome-aware labels for completed notifications", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 0, notifications: [{ id: "99999999-9999-4999-8999-999999999999", type: "tmc_transfer.completed", requestId: REQUEST.id, itemId: null, safePayload: { status: "accepted", isAdministrativeDecision: false }, occurredAt: REQUEST.createdAt, readAt: "2026-08-10T01:00:00.000Z" }] }) } as Response);
    render(<TmcNotifications />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "tmc.notifications.title" }));

    expect(screen.getByText("tmc.notifications.accepted")).not.toBeNull();
  });

  it("renders a large compact bell touch target", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 0, notifications: [] }) } as Response);
    render(<TmcNotifications compact />);
    const bell = screen.getByRole("button", { name: "tmc.notifications.title" });
    expect(bell.className).toContain("min-h-11");
    expect(bell.className).toContain("min-w-11");
  });

  it("polls for newly arrived requests while the recipient stays on the same page", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ unreadCount: 0, notifications: [] }) } as Response);
    render(<TmcNotifications />);
    await act(async () => { await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
