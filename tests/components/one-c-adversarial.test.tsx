import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OneCReconciliationManager from "@/components/OneCReconciliationManager";
import { INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit";

const id = "11111111-1111-4111-8111-111111111111";
const snapshot = (sha256: string) => ({ id, filename: "material.xls", sha256, byteSize: 4,
  receivedAt: "2026-10-01T08:00:00Z", selectedAt: "2026-10-01T08:00:00Z",
  acceptedCount: 1, skippedCount: 0, importedAcceptedCount: 1, importedSkippedCount: 0 });
const batch = (version: number) => ({ id, version, received_at: "2026-10-01T08:00:00Z",
  received_count: 1, source_filename: "full.xml", source_sha256: "b".repeat(64),
  request_id: "request", state: "review_required",
  summary: { identifierMatched: version, activeMatched: version, conflicts: 0, inventoryAudit: { id: `run-${version}` } } });
const rows = (name?: string) => ({ rows: { data: name ? [{ external_id: id, review_state: "matched",
  proposed_action: "link", issues: [], matched_item_id: id, matched_item_name: name,
  payload: { name: `payload-${name}`, inventoryNumber: "1350/123", code: "001", residualCost: 1 } }] : [], page: 1, pageSize: 50, total: name ? 1 : 0 } });
const audit = (version: number, hash = "a".repeat(64)) => ({ audit: { run: { id: `run-${version}`,
  batch_id: id, batch_version: version, algorithm_version: String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION),
  sha256: hash, one_c_registry_sha256: "c".repeat(64), run_at: "2026-10-01T08:00:00Z",
  counts: { total: 0, oneCOnly: 0, excelOnly: 0, both: 0, missing: 0, temporary: 0, possible: 0 } },
  data: [], page: 1, pageSize: 50, total: 0 } });
const response = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function open() {
  render(<OneCReconciliationManager initialBatches={{ data: [batch(1)], page: 1, pageSize: 50, total: 1 }} initialSnapshot={snapshot("a".repeat(64))} />);
  fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
  await screen.findByText(/Партия 1С:.*версия 1/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
}

describe("adversarial 1C analysis regressions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["transport", "invalid_json", "invalid_shape", "proxy_error", "ambiguous_server"])("recovers the committed version when the POST response is %s", async (failure) => {
    let version = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) {
        version = 2; // Transaction committed; the connection failed before the client received its response.
        if (failure === "invalid_json") return new Response("{");
        if (failure === "invalid_shape") return response({});
        if (failure === "proxy_error") return new Response("<html>Gateway timeout</html>", { status: 504 });
        if (failure === "ambiguous_server") return new Response(JSON.stringify({ error: "one_c_reconciliation_unavailable" }), { status: 503 });
        throw new TypeError("Failed to fetch");
      }
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(version) });
      if (url.includes("/audit?")) return response(audit(version));
      return response(rows());
    });
    vi.stubGlobal("fetch", fetchMock);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Запустить dry-run" }).hasAttribute("disabled")).toBe(false));
    await waitFor(() => expect(screen.queryByText(/Точные совпадения с ТМЦ: 2/)).not.toBeNull());
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toContain("Dry-run не выполнен");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/analyze"))).toHaveLength(1);
  });

  it("preserves an explicit server rejection without entering uncertain-result recovery", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) return new Response(JSON.stringify({ error: "material_snapshot_integrity_mismatch" }), { status: 503 });
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(1) });
      if (url.includes("/audit?")) return response(audit(1));
      return response(rows());
    });
    vi.stubGlobal("fetch", fetchMock);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("загрузите файл заново");
    expect(screen.getByText(/Партия 1С:.*версия 1/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/batches/${id}`))).toHaveLength(2);
  });

  it("keeps the latest selected candidate when earlier candidate lookup finishes last", async () => {
    const secondExternalId = "22222222-2222-4222-8222-222222222222";
    const oldCandidate = deferred<Response>();
    const initialRows = rows("Existing item");
    initialRows.rows.data.push({ ...initialRows.rows.data[0], external_id: secondExternalId,
      payload: { ...initialRows.rows.data[0].payload, name: "Second imported item" } });
    initialRows.rows.total = 2;
    const candidate = (name: string) => ({ id, name, inventoryNumber: "1350/123", oneCCode: "001", status: "active", version: 1, matchedBy: ["code"] });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/rows/${id}/candidates`)) return oldCandidate.promise;
      if (url.includes(`/rows/${secondExternalId}/candidates`)) return response({ candidates: [candidate("Latest candidate")] });
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(1) });
      if (url.includes("/audit?")) return response(audit(1));
      return response(initialRows);
    }));
    await open();
    const buttons = screen.getAllByRole("button", { name: "Выбрать другой предмет" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    await screen.findByText("Latest candidate");
    await act(async () => { oldCandidate.resolve(response({ candidates: [candidate("Stale candidate")] })); await oldCandidate.promise; });
    expect(screen.queryByText("Stale candidate")).toBeNull();
    expect(screen.getByText("Latest candidate")).toBeTruthy();
  });

  it("rejects an earlier audit filter response that arrives after new analysis", async () => {
    let version = 1;
    const oldAudit = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) { version = 2; return response({ analysis: {} }); }
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(version) });
      if (url.includes("/audit?")) {
        if (url.includes("source=1c")) return oldAudit.promise;
        return response(audit(version));
      }
      return response(rows());
    }));
    await open();
    fireEvent.change(screen.getByRole("combobox", { name: "Источник сводки" }), { target: { value: "1c" } });
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    await screen.findByText(/Партия 1С:.*версия 2/);
    await act(async () => { oldAudit.resolve(response(audit(1))); await oldAudit.promise; });
    expect(screen.queryByText(/Партия 1С:.*версия 1/)).toBeNull();
    expect(screen.getByText(/Партия 1С:.*версия 2/)).toBeTruthy();
  });

  it("does not attach a delayed audit to a different selected batch", async () => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    const oldAudit = deferred<Response>();
    const secondAudit = audit(2);
    secondAudit.audit.run.batch_id = secondId;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(1) });
      if (url.endsWith(`/batches/${secondId}`)) return response({ batch: { ...batch(2), id: secondId } });
      if (url.includes("/audit?") && url.includes("source=1c")) return oldAudit.promise;
      if (url.includes("/audit?")) return response(url.includes(secondId) ? secondAudit : audit(1));
      return response(rows());
    }));
    render(<OneCReconciliationManager initialBatches={{ data: [batch(1), { ...batch(2), id: secondId }], page: 1, pageSize: 50, total: 2 }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Открыть сверку" })[0]);
    await screen.findByText(/Партия 1С:.*версия 1/);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Открыть сверку" })[1].hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByRole("combobox", { name: "Источник сводки" }), { target: { value: "1c" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Открыть сверку" })[1]);
    await screen.findByText(/Партия 1С:.*версия 2/);
    await act(async () => { oldAudit.resolve(response(audit(1))); await oldAudit.promise; });
    expect(screen.queryByText(/Партия 1С:.*версия 1/)).toBeNull();
    expect(screen.getByText(/Партия 1С:.*версия 2/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Скачать сводку Excel" }).getAttribute("href")).toContain(secondId);
  });

  it("rejects old row requests launched during dry-run when they arrive after new results", async () => {
    let version = 1;
    const post = deferred<Response>();
    const oldRows = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/analyze")) return post.promise;
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(version) });
      if (url.includes("/audit?")) return response(audit(version));
      if (url.includes("/rows?") && url.includes("match=active") && version === 1) {
        return oldRows.promise;
      }
      return response(rows(version === 2 ? "Current matching item" : undefined));
    }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать активные совпадения" }));
    version = 2;
    await act(async () => { post.resolve(response({ analysis: {} })); await post.promise; });
    await screen.findByText("Current matching item");
    await act(async () => { oldRows.resolve(response(rows("Stale matching item"))); await oldRows.promise; });
    expect(screen.queryByText("Stale matching item")).toBeNull();
    expect(screen.getByText("Current matching item")).toBeTruthy();
  });

  it("warns when Excel changes while the server is analyzing its previous snapshot", async () => {
    let version = 1;
    const post = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/material-snapshot")) return response({ snapshot: snapshot("d".repeat(64)) });
      if (url.endsWith("/analyze")) return post.promise;
      if (url.endsWith(`/batches/${id}`)) return response({ batch: batch(version) });
      if (url.includes("/audit?")) return response(audit(version));
      return response(rows());
    }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Запустить dry-run" }));
    fireEvent.change(screen.getByLabelText("Файл материальной ведомости XLS"), { target: { files: [new File(["test"], "material.xls")] } });
    fireEvent.submit(screen.getByRole("button", { name: "Загрузить Excel" }).closest("form")!);
    await screen.findByText("d".repeat(64));
    version = 2;
    await act(async () => { post.resolve(response({ analysis: {} })); await post.promise; });
    await screen.findByText(/Эта сводка построена по прежнему снимку Excel/);
    expect(screen.getByText(/Партия 1С:.*версия 2/)).toBeTruthy();
  });
});
