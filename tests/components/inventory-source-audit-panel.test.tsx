import InventorySourceAuditPanel,{ type AuditPage } from "@/components/InventorySourceAuditPanel";
import { INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit-review";
import { render,screen } from "@testing-library/react";
import { describe,expect,it,vi } from "vitest";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: "ru", locale: "ru-RU" }) }));

const page: AuditPage = {
  run: { id: "audit", batch_id: "batch", batch_version: 12, algorithm_version: String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION),
    one_c_registry_sha256: "c".repeat(64), sha256: "a".repeat(64), run_at: "2026-10-05T04:17:11Z",
    material_source: { kind: "materials_api", batchId: "materials", sha256: "a".repeat(64), receivedAt: "2026-10-16T14:03:21Z", snapshotAt: "2026-10-16T14:03:08Z", rowCount: 14364, materialCount: 8882, positiveRows: 14000, nonPositiveRows: 364 },
    counts: { total: 1988, oneCOnly: 736, excelOnly: 294, both: 67, missing: 891, temporary: 669, possible: 325 } },
  data: [], page: 1, pageSize: 50, total: 1988,
};

describe("inventory audit counts and source explanations", () => {

  it("warns about replaced or edited items even when the saved and current totals agree", () => {
    const current = { ...page, run: { ...page.run, inventory: { currentTotal: 1988, currentActive: 1900, currentQuantity: 1988, currentActiveQuantity: 1900, added: 1, removed: 1, changed: 0, stale: false } } };
    const view = render(<InventorySourceAuditPanel batchId="batch" audit={current} busy={false} onLoad={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    view.rerender(<InventorySourceAuditPanel batchId="batch" audit={{ ...current, run: { ...current.run, inventory: { ...current.run.inventory, stale: true } } }} busy={false} onLoad={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps old Excel evidence explicitly historical and cannot apply it as a current API audit", () => {
    render(<InventorySourceAuditPanel batchId="batch" audit={{ ...page, run: { ...page.run, material_source: null } }} busy={false} onLoad={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(true);

    expect(screen.queryByRole("table")).toBeNull();
  });
});
