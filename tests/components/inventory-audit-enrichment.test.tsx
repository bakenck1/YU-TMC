import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryAuditEnrichment from "@/components/InventoryAuditEnrichment";

const batchId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const plan = { runId, planHash: "a".repeat(64), counts: { ready: 1, unchanged: 0, skipped: 1 }, rows: [
  { itemId: "item", itemVersion: 1, currentName: "Ноутбук", currentCode: null,
    nextName: "Ноутбук Lenovo №2411/00388", nextCode: "00003254", eligible: true, changed: true, reason: "ready" },
] };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const props = { batchId, runId, blocked: false, onApplied: vi.fn() };

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("reviewing and applying confirmed inventory codes", () => {
  it("does not change inventory during preview and applies only the reviewed run and hash", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan })).mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryAuditEnrichment {...props} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    await screen.findByRole("button", { name: "Применить 1 обновлений" });
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    expect(screen.getByText("00003254")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Применить 1 обновлений" }));
    await screen.findByRole("status");
    expect(fetcher.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ runId, planHash: plan.planHash });
    expect(props.onApplied).toHaveBeenCalledOnce();
  });

  it("allows a new preview after definitive stale rejection instead of trapping the user", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan })).mockResolvedValueOnce(reply({ error: "conflict" }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Применить 1 обновлений" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Проверить результат обновления" })).toBeNull();
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(false);
    expect(props.onApplied).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous lost response by replaying the same plan rather than inventing another update", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan })).mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Применить 1 обновлений" }));
    const retry = await screen.findByRole("button", { name: "Проверить результат обновления" });
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    await screen.findByRole("status");
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(props.onApplied).toHaveBeenCalledOnce();
  });

  it("ignores a delayed preview for an older batch even when fetch does not honour abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    view.rerender(<InventoryAuditEnrichment {...props} batchId="33333333-3333-4333-8333-333333333333" />);
    await act(async () => { resolve(reply({ plan })); });
    expect(screen.queryByRole("button", { name: "Применить 1 обновлений" })).toBeNull();
    expect(screen.queryByText("00003254")).toBeNull();
  });

  it("preserves the success result while the parent refreshes and blocks an outdated audit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ plan })).mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 1 } })));
    const view = render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Применить 1 обновлений" }));
    await screen.findByRole("status");
    view.rerender(<InventoryAuditEnrichment {...props} blocked />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Обновлено карточек: 1"));
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
