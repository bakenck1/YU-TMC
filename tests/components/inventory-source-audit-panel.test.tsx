import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InventorySourceAuditPanel, { type AuditPage } from "@/components/InventorySourceAuditPanel";
import { INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit";

const page: AuditPage = {
  run: { id: "audit", batch_id: "batch", batch_version: 12, algorithm_version: String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION),
    one_c_registry_sha256: "c".repeat(64), sha256: "a".repeat(64), run_at: "2026-10-05T04:17:11Z",
    counts: { total: 1988, oneCOnly: 736, excelOnly: 294, both: 67, missing: 891, temporary: 669, possible: 325 } },
  data: [], page: 1, pageSize: 50, total: 1988,
};

describe("inventory audit counts and source explanations", () => {
  it("names source categories and explains overlap and subsets", () => {
    render(<InventorySourceAuditPanel batchId="batch" audit={page} busy={false} onLoad={vi.fn()} />);
    expect(screen.getAllByText("ОС").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Материальный предмет").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ОС + Материальный предмет").length).toBeGreaterThan(0);
    expect(screen.queryByText("Только 1С")).toBeNull();
    expect(screen.queryByText("Только Excel")).toBeNull();
    expect(screen.getByText(/736 \+ 294 \+ 67 \+ 891 = 1988/)).toBeTruthy();
    expect(screen.getByText(/одна карточка найдена в обоих источниках/i)).toBeTruthy();
    expect(screen.getByText(/669.*входят в.*891/)).toBeTruthy();
  });

  it("distinguishes saved 1988 records from 2040 current active records and their quantities", () => {
    const audit = { ...page, run: { ...page.run, inventory: {
      currentTotal: 2045, currentActive: 2040, currentQuantity: 3000, currentActiveQuantity: 2900,
      added: 57, removed: 0, changed: 2, stale: true,
    } } };
    render(<InventorySourceAuditPanel batchId="batch" audit={audit} busy={false} onLoad={vi.fn()} />);
    expect(screen.getByText(/Сейчас на сайте: 2045 карточек, из них активных: 2040/)).toBeTruthy();
    expect(screen.getByText(/Количество единиц: 3000, из них в активных карточках: 2900/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/добавлено 57.*удалено 0.*изменено 2/);
    expect(screen.getByRole("alert").textContent).toContain("dry-run");
    expect(screen.getByText("1988")).toBeTruthy();
  });

  it("warns about replaced or edited items even when the saved and current totals agree", () => {
    const audit = { ...page, run: { ...page.run, inventory: {
      currentTotal: 1988, currentActive: 1900, currentQuantity: 1988, currentActiveQuantity: 1900,
      added: 1, removed: 1, changed: 0, stale: true,
    } } };
    render(<InventorySourceAuditPanel batchId="batch" audit={audit} busy={false} onLoad={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/добавлено 1.*удалено 1/);
  });
});
