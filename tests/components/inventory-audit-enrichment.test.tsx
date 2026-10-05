import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryAuditEnrichment from "@/components/InventoryAuditEnrichment";

const batchId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const plan = { runId, planHash: "a".repeat(64), counts: { ready: 1, unchanged: 0, skipped: 1 }, rows: [
  { itemId: "item", itemVersion: 1, currentName: "Ноутбук", currentCode: null,
    nextName: "Ноутбук Lenovo №2411/00388", nextCode: "00003254", eligible: true, changed: true, reason: "confirmed" },
  { itemId: "missing-excel", itemVersion: 1, currentName: "Стул", currentCode: null,
    nextName: "Стул", nextCode: null, eligible: false, changed: false, reason: "sources_missing", missingSources: ["excel"] },
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

  it("explains each missing source when no updates are ready and hides proposals for skipped cards", async () => {
    const skipped = (itemId: string, currentName: string, missingSources?: Array<"1c" | "excel">) => ({
      ...plan.rows[0], itemId, currentName, currentCode: "00009999", nextName: currentName, nextCode: "00009999",
      eligible: false, changed: false, reason: "sources_missing", ...(missingSources ? { missingSources } : {}),
    });
    const emptyPlan = { ...plan, counts: { ready: 0, unchanged: 0, skipped: 5 }, rows: [
      skipped("one-c-missing", "Стул", ["1c"]), skipped("excel-missing-1", "Стол", ["excel"]),
      skipped("excel-missing-2", "Шкаф", ["excel"]), skipped("both-missing", "Диван", ["1c", "excel"]),
      skipped("legacy", "Кресло"),
    ] };
    const fetcher = vi.fn().mockResolvedValue(reply({ plan: emptyPlan }));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    await screen.findByText("Можно обновить: 0. Без изменений: 0. Пропущено: 5.");
    const reasons = within(screen.getByRole("list", { name: "Причины пропуска" })).getAllByRole("listitem").map((row) => row.textContent);
    expect(reasons).toEqual(expect.arrayContaining([
      "Нет подтверждения в 1С — проверьте загруженную партию и полный номер: 1",
      "Нет подтверждения в Excel — проверьте файл и полный номер: 2",
      "Нет подтверждения в 1С и Excel — проверьте оба источника: 1",
      "Нужны подтверждения из 1С и Excel — проверьте источники: 1",
    ]));
    expect(screen.queryByRole("button", { name: /Применить/ })).toBeNull();
    fireEvent.click(screen.getByText("Показать изменения и причины пропуска"));
    const filter = screen.getByRole("combobox", { name: "Какие обновления показать" }) as HTMLSelectElement;
    expect(filter.value).toBe("skipped");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const cells = within(row).getAllByRole("cell");
      expect(cells[1].textContent).toBe("—");
      expect(cells[2].textContent).toBe("—");
    }
    expect(screen.queryByText("00009999")).toBeNull();
    fireEvent.change(filter, { target: { value: "reason:sources_missing:1c" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Стул" })).not.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });

  it("shows confirmed changes first and lets the reviewer inspect unchanged and skipped cards", async () => {
    const mixedPlan = { ...plan, counts: { ready: 1, unchanged: 1, skipped: 1 }, rows: [
      { ...plan.rows[0], itemId: "skipped", currentName: "Стул", currentCode: "00009999", nextName: "Стул", nextCode: "00009999", eligible: false, changed: false, reason: "code_conflict" },
      { ...plan.rows[0], itemId: "unchanged", currentName: "Монитор", nextName: "Монитор", nextCode: "00008888", changed: false, reason: "unchanged" },
      plan.rows[0],
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: mixedPlan })));
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    await screen.findByRole("button", { name: "Применить 1 обновлений" });
    fireEvent.click(screen.getByText("Показать изменения и причины пропуска"));
    const filter = screen.getByRole("combobox", { name: "Какие обновления показать" }) as HTMLSelectElement;
    expect(filter.value).toBe("ready");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByRole("link", { name: "Ноутбук" })).not.toBeNull();
    expect(within(table).getByText("Ноутбук Lenovo №2411/00388")).not.toBeNull();
    expect(within(table).getByText("00003254")).not.toBeNull();
    expect(within(table).queryByRole("link", { name: "Стул" })).toBeNull();
    fireEvent.change(filter, { target: { value: "unchanged" } });
    expect(within(table).getByRole("link", { name: "Монитор" })).not.toBeNull();
    expect(within(table).getByText("00008888")).not.toBeNull();
    fireEvent.change(filter, { target: { value: "all" } });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).queryByText("00009999")).toBeNull();
    expect(within(table).getByText("Коды источников или карточки не совпадают — проверьте значения")).not.toBeNull();
  });
});
