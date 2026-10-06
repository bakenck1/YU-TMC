import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OneCReconciliationManager from "@/components/OneCReconciliationManager";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const currentBatch = { id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 1, state: "review_required", version: 1, source_filename: "full.xml", source_sha256: "c".repeat(64), request_id: "request-1" };

describe("1C reconciliation manager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows missing cabinets, resets unrelated filters and exports the entire missing list", async () => {
    const row = { external_id: "cabinet-1", review_state: "blocked", match_method: "new_candidate", issues: [{ code: "missing_room" }], payload: { name: "Шкаф книжный", inventoryNumber: "0001/02", status: "Принято к учёту", location: "Библиотека", responsibleName: "Иванов" } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...currentBatch, summary: { identifierMatched: 0, activeMatched: 0, conflicts: 0, missingInventory: 1 } } }));
      return new Response(JSON.stringify({ rows: { data: [row], page: 1, pageSize: 50, total: 1 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [currentBatch], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText("Осы шкаф жоқ — нет в Inventory");
    expect(screen.getByRole("heading", { name: "Нет в Inventory: 1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Скачать отсутствующие в Excel" }).getAttribute("href")).toBe(`/api/integrations/1c/batches/${BATCH_ID}/export?scope=missing`);
    await waitFor(() => expect(screen.getByRole("button", { name: "Показать отсутствующие" }).hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по строкам" }), { target: { value: "Другое название" } });
    fireEvent.click(screen.getByRole("button", { name: "Показать отсутствующие" }));
    await waitFor(() => {
      const url = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "https://inventory.test");
      expect(url.searchParams.get("match")).toBe("missing");
      expect(url.searchParams.get("page")).toBe("1");
      expect(url.searchParams.has("search")).toBe(false);
      expect(url.searchParams.has("reviewState")).toBe(false);
      expect(url.searchParams.has("proposedAction")).toBe(false);
    });
  });

  it("opens the current batch and reuses its latest version after analysis and reopening", async () => {
    let serverVersion = 11;
    const postedVersions: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/analyze")) {
        const version = JSON.parse(String(init?.body)).version;
        postedVersions.push(version);
        if (version !== serverVersion) return new Response(JSON.stringify({ error: "batch_version_conflict" }), { status: 409 });
        serverVersion++;
        return new Response(JSON.stringify({ analysis: {} }));
      }
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...currentBatch, version: serverVersion, summary: { identifierMatched: serverVersion, activeMatched: 1, conflicts: 0 } } }));
      return new Response(JSON.stringify({ rows: { data: [], page: 1, pageSize: 50, total: 0 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [{ ...currentBatch, version: 1 }], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText(/Точные совпадения с ТМЦ: 11/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    await screen.findByText(/Точные совпадения с ТМЦ: 12/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Открыть сверку" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText(/Точные совпадения с ТМЦ: 12/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    await screen.findByText(/Точные совпадения с ТМЦ: 13/);
    expect(postedVersions).toEqual([11, 12]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refreshes a concurrent version conflict without automatically repeating the mutation", async () => {
    let serverVersion = 1;
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) {
        posts++; serverVersion = 2;
        return new Response(JSON.stringify({ error: "batch_version_conflict" }), { status: 409 });
      }
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...currentBatch, version: serverVersion, summary: { identifierMatched: serverVersion, activeMatched: 1, conflicts: 0 } } }));
      return new Response(JSON.stringify({ rows: { data: [], page: 1, pageSize: 50, total: 0 } }));
    }));
    render(<OneCReconciliationManager initialBatches={{ data: [currentBatch], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByRole("textbox", { name: "Поиск по строкам" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Партия изменилась"));
    await screen.findByText(/Точные совпадения с ТМЦ: 2/);
    expect(posts).toBe(1);
  });

  it("distinguishes a committed analysis from a failure to load its results", async () => {
    let completed = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) { completed = true; return new Response(JSON.stringify({ analysis: {} })); }
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...currentBatch, version: completed ? 2 : 1 } }));
      if (completed) return new Response(JSON.stringify({ error: "internal_error" }), { status: 503 });
      return new Response(JSON.stringify({ rows: { data: [], page: 1, pageSize: 50, total: 0 } }));
    }));
    render(<OneCReconciliationManager initialBatches={{ data: [currentBatch], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByRole("textbox", { name: "Поиск по строкам" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Dry-run выполнен, но результаты не удалось загрузить. Откройте сверку заново.");
  });

  it.each([
    ["material_snapshot_integrity_mismatch", "загрузите файл заново"],
    ["one_c_analysis_timeout", "Сервер не успел выполнить dry-run"],
    ["one_c_analysis_schema_outdated", "применить миграции"],
  ])("explains the dry-run failure %s", async (code, message) => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) return new Response(JSON.stringify({ error: code }), { status: 503 });
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: currentBatch }));
      return new Response(JSON.stringify({ rows: { data: [], page: 1, pageSize: 50, total: 0 } }));
    }));
    render(<OneCReconciliationManager initialBatches={{ data: [currentBatch], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByRole("textbox", { name: "Поиск по строкам" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining(message));
  });

  it("uploads the administrator's XLS and shows the selected snapshot hash", async () => {
    const snapshot = { id: "11111111-1111-4111-8111-111111111111", filename: "материалы 2026.xls", sha256: "A".repeat(64), byteSize: 4, receivedAt: "2026-10-01T08:00:00.000Z", acceptedCount: 1, skippedCount: 2, importedAcceptedCount: 1, importedSkippedCount: 2, selectedAt: "2026-10-01T08:00:00.000Z" };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ snapshot }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [], page: 1, pageSize: 50, total: 0 }} />);
    const file = new File(["test"], "материалы 2026.xls", { type: "application/vnd.ms-excel" });
    fireEvent.change(screen.getByLabelText("Файл материальной ведомости XLS"), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole("button", { name: "Загрузить Excel" }).closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/integrations/1c/material-snapshot");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBe(file);
    expect(await screen.findByText("A".repeat(64))).toBeTruthy();
  });

  it("shows all-row pagination and exposes a safe Excel export for a legacy snapshot", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rows: {
      data: [], page: 1, pageSize: 50, total: 6552,
    }, batch: { ...currentBatch, received_count: 6552, version: 2, source_filename: null, request_id: null, summary: { massPublicationBlocked: true } } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{
      data: [{ id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 6552, created_count: 0, updated_count: 0, unchanged_count: 6552, state: "review_required", version: 2, source_filename: null, source_sha256: "a".repeat(64), request_id: null, summary: { massPublicationBlocked: true } }],
      page: 1, pageSize: 50, total: 1,
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText("Показано 1–50 из 6552");
    const exportLink = screen.getByRole("link", { name: "Скачать Excel (6552)" });
    expect(exportLink.getAttribute("href")).toBe(`/api/integrations/1c/batches/${BATCH_ID}/export`);
    expect(screen.queryByRole("button", { name: "Утвердить" })).toBeNull();
    expect(screen.getByText(/исторический снимок без исходного XML/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("page=2"), expect.anything(),
    ));
  });

  it("searches by responsible without sending an invalid empty search", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rows: {
      data: [], page: 1, pageSize: 50, total: 0,
    }, batch: currentBatch }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [{ id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 1, state: "received", version: 1, source_filename: "full.xml", source_sha256: "b".repeat(64), request_id: "request-1" }], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByRole("textbox", { name: "Поиск по строкам" });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("search=");

    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по строкам" }), { target: { value: "Иванов" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("search=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2"));
  });

  it.each([
    ["GUID 1С", "11111111-1111-4111-8111-111111111111"],
    ["коду 1С", "000009352"],
    ["инвентарному номеру", "2416/1056"],
  ])("ищет кандидата по %s без потери формата", async (_label, search) => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rows: {
      data: [], page: 1, pageSize: 50, total: 0,
    }, batch: currentBatch }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [{
      id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 1,
      state: "review_required", version: 1, source_filename: "full.xml",
      source_sha256: "c".repeat(64), request_id: "request-1",
    }], page: 1, pageSize: 50, total: 1 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByRole("textbox", { name: "Поиск по строкам" });
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по строкам" }), { target: { value: search } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));

    await waitFor(() => {
      const url = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "https://inventory.test");
      expect(url.searchParams.get("search")).toBe(search);
    });
  });

  it("lets an administrator choose a different Inventory item and records a manual link", async () => {
    const selectedItemId = "22222222-2222-4222-8222-222222222222";
    const row = {
      external_id: "33333333-3333-4333-8333-333333333333",
      review_state: "matched",
      proposed_action: "link",
      matched_item_id: "44444444-4444-4444-8444-444444444444",
      matched_item_name: "Старый кандидат",
      issues: [],
      payload: {
        code: "000009352", inventoryNumber: "2416/1056", barcode: null,
        name: "Ноутбук", location: "АУП", responsibleName: "Иванов И.И.", residualCost: 100,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...currentBatch, version: 7 } }), { status: 200 });
      if (url.includes("/decision")) {
        return new Response(JSON.stringify({ row: { ...row, matched_item_id: selectedItemId } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/integrations/1c/batches/${BATCH_ID}/rows/${row.external_id}/candidates`)) {
        return new Response(JSON.stringify({ candidates: [{
          id: selectedItemId, name: "Нужный ноутбук", inventoryNumber: "2416/1056", oneCCode: "000009352",
          status: "active", version: 5, matchedBy: ["guid", "code", "inventory_number"],
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ rows: { data: [row], page: 1, pageSize: 50, total: 1 } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [{
      id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 1,
      state: "review_required", version: 7, source_filename: "full.xml",
      source_sha256: "d".repeat(64), request_id: "request-1",
    }], page: 1, pageSize: 50, total: 1 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText("Старый кандидат");
    fireEvent.click(screen.getByRole("button", { name: "Выбрать другой предмет" }));
    await screen.findByText("Нужный ноутбук");
    expect(screen.getByText("GUID 1С")).toBeTruthy();
    expect(screen.getByText("Код 1С")).toBeTruthy();
    expect(screen.getByText("Инвентарный номер")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Связать с этим предметом" }));

    await waitFor(() => {
      const decisionCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/decision"));
      expect(decisionCall).toBeTruthy();
      expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({
        version: 7,
        decision: {
          confirmLink: true,
          itemId: selectedItemId,
          expectedItemVersion: 5,
        },
      });
    });
  });

  it("keeps the batch open after dry-run and lists active identifier matches", async () => {
    const batch = {
      id: BATCH_ID, received_at: "2026-09-22T08:00:00Z", received_count: 10617,
      state: "received", version: 1, source_filename: "inventory.xml",
      source_sha256: "e".repeat(64), request_id: "request-1",
    };
    const matchedRow = {
      external_id: "33333333-3333-4333-8333-333333333333",
      review_state: "matched", matched_item_id: "44444444-4444-4444-8444-444444444444",
      matched_item_name: "Наш моноблок", matched_item_status: "active", match_method: "code+inventory_number",
      issues: [], payload: { code: "0001", inventoryNumber: "2416/1056", barcode: null, name: "Другое название", location: "АУП", responsibleName: null, residualCost: 0 },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/batches/${BATCH_ID}/analyze`)) return new Response(JSON.stringify({ analysis: {} }), { status: 200 });
      if (url.endsWith(`/batches/${BATCH_ID}`)) return new Response(JSON.stringify({ batch: { ...batch, version: 2, state: "review_required", summary: { identifierMatched: 1, activeMatched: 1, conflicts: 0 } } }), { status: 200 });
      return new Response(JSON.stringify({ rows: { data: [matchedRow], page: 1, pageSize: 50, total: 1 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [batch], page: 1, pageSize: 50, total: 1 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await screen.findByText("Наш моноблок");
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    await screen.findByText(/Точные совпадения с ТМЦ: 1/);
    expect(screen.getByText(/Совпало: Код 1С, Инвентарный номер/)).toBeTruthy();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("match=active");
  });
});
