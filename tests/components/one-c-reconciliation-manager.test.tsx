import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OneCReconciliationManager from "@/components/OneCReconciliationManager";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";

describe("1C reconciliation manager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows all-row pagination and exposes a safe Excel export for a legacy snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: {
      data: [], page: 1, pageSize: 50, total: 6552,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: {
      data: [], page: 1, pageSize: 50, total: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OneCReconciliationManager initialBatches={{ data: [{ id: BATCH_ID, received_at: "2026-09-21T10:00:00Z", received_count: 1, state: "received", version: 1, source_filename: "full.xml", source_sha256: "b".repeat(64), request_id: "request-1" }], page: 1, pageSize: 50, total: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть сверку" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("search=");

    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по строкам" }), { target: { value: "Иванов" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("search=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2"));
  });
});
