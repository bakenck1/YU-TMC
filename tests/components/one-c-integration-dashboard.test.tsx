import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OneCIntegrationDashboard from "@/components/OneCIntegrationDashboard";
import type { OneCAnalytics } from "@/lib/one-c-analytics";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";

const { refresh, appLanguage } = vi.hoisted(() => ({ refresh: vi.fn(), appLanguage: { value: "ru" as "ru" | "kk" | "en" } }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: appLanguage.value, locale: appLanguage.value === "en" ? "en-US" : "ru-RU" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const analytics: OneCAnalytics = {
  calculatedAt: "2026-10-22T05:00:00Z",
  assets: { total: 6, active: 6, retired: 0, other: 0, receivedAt: "2026-09-21T10:53:00Z" },
  inventory: { total: 5, active: 5, quantity: 8 },
  reconciliation: { total: 5, fixedAssets: 1, materials: 1, both: 1, possible: 1, missing: 1, temporary: 2, assetsWithoutCandidate: 3, materialBalancesWithoutCandidate: 2 },
};
const materials: MaterialRegistryMetadata = { kind: "materials_api", batchId: null, receivedAt: null, snapshotAt: null, sha256: "empty", rowCount: 0, materialCount: 0, positiveRows: 0, nonPositiveRows: 0 };
const batches = { data: [], page: 1, pageSize: 50, total: 0 };
afterEach(() => { vi.unstubAllGlobals(); appLanguage.value = "ru"; });

describe("integration overview", () => {
  it("shows only the unmatched temporary count with no breakdown or total", () => {
    render(<OneCIntegrationDashboard analytics={{...analytics, inventory:{total:2566, active:2559,quantity:6050}, reconciliation:{...analytics.reconciliation,total:2566,fixedAssets:1116,materials:573,both:0,possible:0,missing:135,temporary:946,temporaryFound:204,temporaryPossible:0,temporaryUnmatched:742}}} materials={materials} />);
    const metric = screen.getByRole("heading", {name:"Всего временных номеров без совпадения"}).parentElement!;
    expect(metric.textContent).toBe("Всего временных номеров без совпадения742");
    expect(screen.queryByText("946")).toBeNull();
    expect(screen.queryByText(/Из них найдено в 1С:/)).toBeNull();
    const attention = screen.getByRole("heading", {name:"Временные без совпадения"}).parentElement!;
    expect(attention.textContent).toContain("742");
    expect(attention.textContent).not.toContain("946");
  });
  it("shows temporary candidates separately and does not call them found", () => {
    render(<OneCIntegrationDashboard analytics={{...analytics,reconciliation:{...analytics.reconciliation,temporary:3,temporaryFound:1,temporaryPossible:1,temporaryUnmatched:1}}} materials={materials} />);
    expect(screen.getByRole("heading", {name:"Всего временных номеров без совпадения"}).parentElement!.textContent).toBe("Всего временных номеров без совпадения1");
  });
  it.each([
    ["kk", "Сәйкестігі жоқ уақытша нөмірлердің жалпы саны"],
    ["en", "Total unmatched temporary numbers"],
  ] as const)("localizes the unmatched temporary metric in %s", (language, text) => {
    appLanguage.value = language;
    render(<OneCIntegrationDashboard analytics={{...analytics,reconciliation:{...analytics.reconciliation,temporary:2,temporaryFound:1,temporaryPossible:0,temporaryUnmatched:1}}} materials={materials} />);
    expect(screen.getByRole("heading", {name:text}).parentElement!.textContent).toBe(`${text}1`);
  });
  it("does not claim zero unmatched temporary cards when sources are unavailable", () => {
    render(<OneCIntegrationDashboard analytics={{...analytics,assets:{...analytics.assets,receivedAt:null}}} materials={materials} />);
    const attention = screen.getByRole("heading", {name:"Временные без совпадения"}).parentElement!;
    expect(attention.textContent).toContain("—");
    expect(screen.queryByText(/Из них найдено в 1С:/)).toBeNull();
  });
  it("groups cards found in both registers under materials without changing the found total", () => {
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} />);
    expect(screen.queryByText("Найдено в ОС и МП")).toBeNull();
    const materialsRow = screen.getAllByText("Материальный предмет").map(element => element.closest("li")).find(Boolean);
    expect(materialsRow?.textContent).toBe("Материальный предмет2");
    expect(screen.getByText("60%")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Наша база" })).getByText("3")).toBeTruthy();
  });
  it("renders the 1C overview in Kazakh and English", () => {
    appLanguage.value = "kk";
    const view = render(<OneCIntegrationDashboard analytics={analytics} materials={materials} />);
    expect(screen.getByRole("heading", { name: "1С интеграциясы" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excel жүктеу · 6 парақ" })).toBeTruthy();
    appLanguage.value = "en";
    view.rerender(<OneCIntegrationDashboard analytics={analytics} materials={materials} />);
    expect(screen.getByRole("heading", { name: "1C integration" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Excel · 6 sheets" })).toBeTruthy();
  });
  it("provides the same full-registry updates in OS and MP with a single review block", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], total: 0, page: 1, pageSize: 50 }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    expect(screen.queryByRole("heading", { name: "Обновление карточек из 1С" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Перейти к сверке ОС" })).toBeNull();
    const navigation = within(screen.getByRole("navigation", { name: "Разделы интеграции 1С" }));
    fireEvent.click(navigation.getByRole("button", { name: "ОС" }));
    expect(screen.getByRole("heading", { name: "Основные средства" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Обновление карточек из 1С" })).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Проверить изменения" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Требует проверки")).toBeNull();
    expect(screen.queryByText("Получена")).toBeNull();
    await screen.findByText("Нет основных средств на учёте");
    expect(fetcher.mock.calls[0][0]).toContain("/api/integrations/1c/assets/registry");
    fireEvent.click(navigation.getByRole("button", { name: "Материальный предмет" }));
    expect(screen.getAllByRole("heading", { name: "Обновление карточек из 1С" })).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Проверить изменения" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(navigation.getByRole("button", { name: "Аналитика" }));
    expect(screen.queryByRole("heading", { name: "Обновление карточек из 1С" })).toBeNull();
  });
  it("reports export errors and leaves the dashboard usable for another download", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("failed", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} batches={batches} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel · 6 листов" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Не удалось скачать Excel. Повторите попытку.");
    expect(fetcher).toHaveBeenCalledWith("/api/integrations/1c/analytics/export", { cache: "no-store" });
    expect((screen.getByRole("button", { name: "Скачать Excel · 6 листов" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each([
    ["HTML вместо файла", "<html>login</html>", "text/html"],
    ["пустой файл", "", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("rejects an invalid download: %s", async (_label, body, contentType) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": contentType } })));
    render(<OneCIntegrationDashboard analytics={analytics} materials={materials} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать Excel · 6 листов" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Не удалось скачать Excel. Повторите попытку.");
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
    expect(screen.getByText("5 активных карточек")).toBeTruthy();
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
    expect(composition.getByText("9")).toBeTruthy();
    expect(composition.getByText("6 ОС + 3 МП = 9")).toBeTruthy();
    expect(screen.queryByText("ОС и материальный предмет")).toBeNull();
    expect(screen.queryByText("Проверить совпадения")).toBeNull();
    expect(screen.queryByText("снято с учёта", { exact: false })).toBeNull();
    const inventory = within(screen.getByRole("region", { name: "Наша база" }));
    expect(inventory.getByText("8")).toBeTruthy();
    expect(inventory.getByText("3")).toBeTruthy();
    expect(screen.queryByText("Сколько всего в 1С сейчас?")).toBeNull();
  });
});
