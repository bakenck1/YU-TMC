import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OneCIntegrationDashboard from "@/components/OneCIntegrationDashboard";
import type { OneCAnalytics } from "@/lib/one-c-analytics";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const analytics: OneCAnalytics = {
  calculatedAt: "2026-10-22T05:00:00Z",
  assets: { total: 7, active: 6, retired: 1, other: 0, receivedAt: "2026-09-21T10:53:00Z" },
  inventory: { total: 5, active: 4, quantity: 8 },
  reconciliation: { total: 5, fixedAssets: 1, materials: 1, both: 1, possible: 1, missing: 1, temporary: 2, assetsWithoutCandidate: 3, materialBalancesWithoutCandidate: 2 },
};
const materials: MaterialRegistryMetadata = { kind: "materials_api", batchId: null, receivedAt: null, snapshotAt: null, sha256: "empty", rowCount: 0, materialCount: 0, positiveRows: 0, nonPositiveRows: 0 };
const batches = { data: [], page: 1, pageSize: 50, total: 0 };
afterEach(() => vi.unstubAllGlobals());

describe("integration overview", () => {
  it("enables the whole-registry check without an audit and keeps a single block across tabs", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    expect(screen.getByRole("heading", { name: "Названия и коды 1С в карточках ТМЦ" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Проверить обновления названий и кодов" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Перейти к сверке ОС" })).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Разделы интеграции 1С" }));
    fireEvent.click(navigation.getByRole("button", { name: "ОС" }));
    expect(screen.getByRole("heading", { name: "Основные средства" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Названия и коды 1С в карточках ТМЦ" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Названия и коды 1С в карточках ТМЦ" })).toHaveLength(1);
    fireEvent.click(navigation.getByRole("button", { name: "Материальный предмет" }));
    expect(screen.getAllByRole("heading", { name: "Названия и коды 1С в карточках ТМЦ" })).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports export errors and leaves the dashboard usable for another download", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel · 5 листов" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Не удалось скачать Excel. Повторите попытку.");
    expect(fetcher).toHaveBeenCalledWith("/api/integrations/1c/analytics/export", { cache: "no-store" });
    expect((screen.getByRole("button", { name: "Скачать Excel · 5 листов" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("identifies the local database and does not present absent OS as zero stock", () => {
    render(<OneCIntegrationDashboard analytics={{ ...analytics, assets: { total: 0, active: 0, retired: 0, other: 0, receivedAt: null } }} materials={materials} batches={batches} localEnvironment />);
    expect(screen.getByText("Локально")).toBeTruthy();
    expect(screen.getByText("Нет данных для сверки")).toBeTruthy();
    expect(screen.getByText("Нет данных для общего итога")).toBeTruthy();
  });
  it("shows unknown materials without claiming zero stock, and refreshes the real server data", () => {
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    expect(screen.getByText("Нет данных для общего итога")).toBeTruthy();
    expect(screen.getByText("4 активных карточек")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Материальная ведомость Excel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps reconciliation and materials in distinct navigable panels", () => {
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    expect(screen.queryByRole("heading", { name: "Основные средства" })).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Разделы интеграции 1С" }));
    fireEvent.click(navigation.getByRole("button", { name: "ОС" }));
    expect(screen.getByRole("heading", { name: "Основные средства" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Материальный предмет" })).toBeNull();
    fireEvent.click(navigation.getByRole("button", { name: "Материальный предмет" }));
    expect(screen.getByRole("heading", { name: "Материальный предмет" })).toBeTruthy();
  });

  it("renders empty charts without NaN or misleading stock totals", () => {
    const empty: OneCAnalytics = { ...analytics, inventory: { total: 0, active: 0, quantity: 0 }, reconciliation: { total: 0, fixedAssets: 0, materials: 0, both: 0, possible: 0, missing: 0, temporary: 0, assetsWithoutCandidate: 0, materialBalancesWithoutCandidate: 0 } };
    const { container } = render(<OneCIntegrationDashboard analytics={empty} materials={materials} batches={batches} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("sums OS and distinct material positions, never balance rows or inventory units", () => {
    render(<OneCIntegrationDashboard analytics={analytics} materials={{ ...materials, batchId: "mp", materialCount: 3, rowCount: 50, positiveRows: 40 }} batches={batches} />);
    const composition = within(screen.getByRole("region", { name: "Состав 1С" }));
    expect(composition.getByText("10")).toBeTruthy();
    expect(composition.getByText("7 ОС + 3 МП = 10")).toBeTruthy();
    const inventory = within(screen.getByRole("region", { name: "Наша база" }));
    expect(inventory.getByText("8")).toBeTruthy();
    expect(inventory.getByText("3")).toBeTruthy();
    expect(screen.queryByText("Сколько всего в 1С сейчас?")).toBeNull();
  });
});
