import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryAuditEnrichment, { InventoryCurrentEnrichment } from "@/components/InventoryAuditEnrichment";

const { appLanguage } = vi.hoisted(() => ({ appLanguage: { value: "ru" as "ru" | "kk" | "en" } }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: appLanguage.value, locale: appLanguage.value === "en" ? "en-US" : "ru-RU" }) }));

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

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); appLanguage.value = "ru"; });

describe("reviewing and applying confirmed inventory codes", () => {
  it("reviews and applies only temporary cards and resets the plan when the scope changes", async () => {
    const temporaryPlan = { ...plan, runId: "current-registry-temporary", rows: [
      { ...plan.rows[0], temporaryMatch: { found: true, category: "materials" } },
      { ...plan.rows[1], temporaryMatch: { found: false, category: "missing" } },
    ] };
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan: temporaryPlan })).mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const onApplied = vi.fn();
    const view = render(<InventoryCurrentEnrichment temporaryOnly onApplied={onApplied} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    expect(await screen.findByText("Найдено в 1С")).toBeTruthy();
    expect(fetcher.mock.calls[0][0]).toBe("/api/integrations/1c/enrichment?scope=temporary");
    fireEvent.click(screen.getByRole("button", { name: "Применить 1 обновлений" }));
    await screen.findByRole("status");
    expect(fetcher.mock.calls[1][0]).toBe("/api/integrations/1c/enrichment?scope=temporary");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ runId: temporaryPlan.runId, planHash: temporaryPlan.planHash });
    expect(onApplied).toHaveBeenCalledOnce();
    view.rerender(<InventoryCurrentEnrichment onApplied={onApplied} />);
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("translates current-registry review and price status", async () => {
    appLanguage.value = "en";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: { ...plan, runId: "current-registry", counts: { ready: 0, unchanged: 1, skipped: 0 }, rows: [{ ...plan.rows[0], changed: false, price: { currentUnitPrice: "100", nextUnitPrice: "100", changed: false, status: "missing" } }] } })));
    render(<InventoryCurrentEnrichment onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByText("No price in 1C")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Update cards from 1C" })).toBeTruthy();
  });
  it("shows the actual source name and structured number when an identity conflicts", async () => {
    const conflict = { ...plan.rows[0], eligible: false, changed: false, reason: "identity_conflict", siteNumber: "2411/0390",
      sourceDetails: [{ kind: "ОС", name: "Ноутбук Lenovo IdeaPad №2411/00390", inventoryNumber: "2411/0390", barcode: null }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: { ...plan, runId: "current-registry", counts: { ready: 0, unchanged: 0, skipped: 1 }, rows: [conflict] } })));
    render(<InventoryCurrentEnrichment onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    await screen.findByText("Сравнить номера и названия");
    expect(screen.getByText("Основные средства: Ноутбук Lenovo IdeaPad №2411/00390")).toBeTruthy();
    expect(screen.getAllByText("2411/0390")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Применить/ })).toBeNull();
  });
  it("shows the reviewed price and responsible person before applying a price-only update", async () => {
    const pricePlan = { ...plan, runId: "current-registry", counts: { ready: 1, unchanged: 0, skipped: 0 }, rows: [{ ...plan.rows[0],
      price: { currentUnitPrice: "100.00", nextUnitPrice: "9100.50", changed: true, status: "ready", source: "material_unit_price" },
      responsibility: { currentUserId: null, currentName: null, nextUserId: "owner", nextName: "Бауыржан Тынымбаев", changed: true, status: "ready", sourceName: "Тынымбаев Бауыржан Анесович" },
    }] };
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan: pricePlan })).mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 0 } }));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryCurrentEnrichment onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    const apply = await screen.findByRole("button", { name: "Применить 1 обновлений" });
    expect(screen.getByText("Изменение цены: 1")).toBeTruthy();
    expect(screen.getByText("Изменение ответственного: 1")).toBeTruthy();
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "Цена за единицу, ₸" })).toBeTruthy();
    expect(table.getByText(/9\s100,5 ₸/u)).toBeTruthy();
    expect(table.getByText("Было: 100 ₸")).toBeTruthy();
    expect(table.getByText("МП · цена за единицу")).toBeTruthy();
    expect(table.getByText("Бауыржан Тынымбаев")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent.click(apply);
    await screen.findByRole("status");
    expect(fetcher.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ runId: "current-registry", planHash: plan.planHash });
  });
  it("searches beyond the rendered first 100 rows and shows limited responsibility proposals", async () => {
    const rows = Array.from({ length: 151 }, (_, index) => ({ ...plan.rows[0], itemId: `item-${index}`, currentName: `Предмет ${index}`, nextName: `Новое название ${index}`, siteNumber: `1350/${index}`,
      searchText: index === 150 ? "YUB-1350/99150" : "",
      responsibility: { currentUserId: null, currentName: null, nextUserId: "person", nextName: "Бауыржан Анесович", changed: true, status: "ready" as const, sourceName: "Бауыржан Анесович" } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: { ...plan, runId: "current-registry", counts: { ready: 151, unchanged: 0, skipped: 0 }, rows } })));
    render(<InventoryCurrentEnrichment onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    await screen.findByRole("button", { name: "Применить 151 обновлений" });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(101);
    const search = screen.getByRole("textbox", { name: "Поиск по всем карточкам сверки" });
    fireEvent.change(search, { target: { value: "YUB-1350/99150" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Предмет 150" })).toBeTruthy();
    expect(screen.getByText("Будет назначен")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Применить 151 обновлений" })).toBeTruthy();
    fireEvent.change(search, { target: { value: "нет такого" } });
    expect(screen.getByText("В этой группе нет карточек.")).toBeTruthy();
  });
  it("previews and applies the full OS and MP registry directly, without a batch or dry-run", async () => {
    const currentPlan = { ...plan, runId: "current-registry", sources: { fixedAssets: 100, materials: 40, materialBalances: 55, cards: 2 },
      rows: [{ ...plan.rows[0], nameSource: "materials_api" }, plan.rows[1]] };
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan: currentPlan })).mockResolvedValueOnce(reply({ result: { updated: 1, unchanged: 0, skipped: 1 } }));
    const onApplied = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryCurrentEnrichment onApplied={onApplied} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    const apply = await screen.findByRole("button", { name: "Применить 1 обновлений" });
    expect(fetcher.mock.calls[0][0]).toBe("/api/integrations/1c/enrichment");
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    expect(screen.getByText("Проверено основных средств")).toBeTruthy();
    expect(screen.getByText("МП проверено")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("МП")).toBeTruthy();
    fireEvent.click(apply);
    expect((await screen.findByRole("status")).textContent).toBe("Обновлено карточек: 1. Без изменений: 0. Пропущено: 1.");
    expect(fetcher.mock.calls[1][0]).toBe("/api/integrations/1c/enrichment");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ runId: "current-registry", planHash: plan.planHash });
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("clears a stale full-registry plan instead of applying it again", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ plan: { ...plan, runId: "current-registry" } }))
      .mockResolvedValueOnce(reply({ error: "inventory_audit_enrichment_stale" }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<InventoryCurrentEnrichment onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить изменения" }));
    fireEvent.click(await screen.findByRole("button", { name: "Применить 1 обновлений" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Повторите проверку обновлений");
    expect(screen.queryByRole("button", { name: /Применить/ })).toBeNull();
  });
  it("shows the chosen name source and the retained code when only a name is confirmed", async () => {
    const nameOnlyPlan = { ...plan, counts: { ready: 2, unchanged: 0, skipped: 0 }, rows: [
      { ...plan.rows[0], nameSource: "1c", codeStatus: "code_invalid", nextCode: "00009999" },
      { ...plan.rows[0], itemId: "excel-only", currentName: "Стул", nameSource: "excel", codeStatus: "code_missing", nextName: "Стул из Excel", nextCode: null },
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: nameOnlyPlan })));
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    await screen.findByRole("button", { name: "Применить 2 обновлений" });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[2].textContent).toBe("1С");
    expect(within(rows[1]).getAllByRole("cell")[2].textContent).toBe("Excel");
    expect(within(rows[0]).getByText("00009999")).not.toBeNull();
    expect(within(rows[1]).getByText("Стул из Excel")).not.toBeNull();
    expect(screen.getAllByText(/Код сохранён без изменения:/)).toHaveLength(2);
  });
  it("shows old and new codes from either preferred source before applying a replacement", async () => {
    const singleSourcePlan = { ...plan, counts: { ready: 2, unchanged: 0, skipped: 0 }, rows: [
      { ...plan.rows[0], nameSource: "1c", codeStatus: "confirmed", currentCode: "00009999" },
      { ...plan.rows[0], itemId: "excel-only", nameSource: "excel", codeStatus: "confirmed", nextName: "Стул из Excel", nextCode: "00000005003" },
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: singleSourcePlan })));
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    await screen.findByRole("button", { name: "Применить 2 обновлений" });
    expect(screen.getByText("Было: 00009999")).not.toBeNull();
    expect(screen.getByText("00003254")).not.toBeNull();
    expect(screen.getByText("00000005003")).not.toBeNull();
    expect(screen.queryByText(/Код сохранён без изменения:/)).toBeNull();
  });
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

  it("explains a rolled-back shared-number conflict and allows reviewing a new plan", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ plan }))
      .mockResolvedValueOnce(reply({ error: "inventory_audit_enrichment_shared_number_conflict" }, 409)));
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    fireEvent.click(await screen.findByRole("button", { name: "Применить 1 обновлений" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Обновление отменено: название нарушает правило общего номера");
    expect(screen.queryByRole("button", { name: "Проверить результат обновления" })).toBeNull();
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(false);
    expect(props.onApplied).not.toHaveBeenCalled();
  });

  it("shows and filters shared-number skips without offering the rejected rename", async () => {
    const skippedPlan = { ...plan, counts: { ready: 0, unchanged: 0, skipped: 1 }, rows: [
      { ...plan.rows[0], currentName: "Монитор", nextName: "Монитор", eligible: false, changed: false, reason: "shared_number_conflict" },
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ plan: skippedPlan })));
    render(<InventoryAuditEnrichment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления названий и кодов" }));
    expect((await screen.findByRole("list", { name: "Причины пропуска" })).textContent).toContain("включая архив: 1");
    fireEvent.change(screen.getByRole("combobox", { name: "Какие обновления показать" }), { target: { value: "reason:shared_number_conflict" } });
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Монитор" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Применить/ })).toBeNull();
    expect(screen.queryByText("00003254")).toBeNull();
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
      "Нет подтверждения в основных средствах 1С — проверьте партию и полный номер: 1",
      "Нет подтверждения в материалах API 1С — проверьте реестр и полный номер: 2",
      "Нет подтверждения в основных средствах и материалах API 1С — проверьте оба источника: 1",
      "Нет подтверждения в источниках — проверьте полные номера: 1",
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
