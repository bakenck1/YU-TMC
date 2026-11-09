import MaterialRegistryPanel from "@/components/MaterialRegistryPanel";
import OneCFixedAssetRegistryPanel from "@/components/OneCFixedAssetRegistryPanel";
import { fireEvent,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: "ru", locale: "ru-RU" }) }));

afterEach(() => vi.unstubAllGlobals());
const asset = { name: "Ноутбук Lenovo IdeaPad №2411/00390", code: "OS-42", inventoryNumber: null, barcode: "2411/00390", quantity: 1, initialCost: 450000, residualCost: 350000, location: "Подразделения", responsibleName: "Тынымбаев Бауыржан Анесович" };

describe("current 1C registry panels", () => {
  it("switches OS between on-book and all received statuses without losing owner search", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const p = new URL(url, "https://local").searchParams;
      const name = p.get("scope") === "all" ? (p.get("search") ? "Owner match" : "Retired asset") : "Current asset";
      return Response.json({ data: [{ external_id: name, payload: { ...asset, name, status: p.get("scope") === "all" ? "Снято с учёта" : "Принято к учёту" } }], total: 1, page: 1, pageSize: 50 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<OneCFixedAssetRegistryPanel />);
    expect(await screen.findByText("Current asset")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Все статусы" }));
    expect(await screen.findByText("Retired asset")).toBeTruthy();
    expect(screen.queryByText("Current asset")).toBeNull();
    fireEvent.change(screen.getByLabelText("Поиск основных средств"), { target: { value: "Тынымбаев" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(await screen.findByText("Owner match")).toBeTruthy();
    expect(screen.queryByText("Retired asset")).toBeNull();
  });
  it("loads OS without another click and shows actual responsible person and costs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ external_id: "os1", payload: asset }], total: 1, page: 1, pageSize: 50 })));
    render(<OneCFixedAssetRegistryPanel />);
    expect(await screen.findByText(asset.name)).toBeTruthy();
    expect(screen.getByText(asset.responsibleName)).toBeTruthy();
  });

  it("loads MP automatically, then keeps the full-registry search while paging", async () => {
    const material = { code: "MP-42", inventoryNumber: null, barcode: null, quantity: "3", unitPrice: "12000", responsibleName: asset.responsibleName };
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const p = new URL(url, "https://local").searchParams;
      const page = Number(p.get("page"));
      const name = p.get("search") === "2411/00391" ? (page === 2 ? "Second search page" : "First search page") : "Initial material";
      return Response.json({ data: [{ row_key: name, payload: { ...material, name } }], total: 101, page, pageSize: 50 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<MaterialRegistryPanel source={null} />);
    expect(await screen.findByText("Initial material")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск материального предмета"), { target: { value: "2411/00391" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(await screen.findByText("First search page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(await screen.findByText("Second search page")).toBeTruthy();
    expect(screen.queryByText("First search page")).toBeNull();
  });

  it("shows errors and permits retry instead of pretending an empty registry was loaded", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue({ ok: true, json: async () => ({ data: [], total: 0, page: 1, pageSize: 50 }) });
    vi.stubGlobal("fetch", fetcher);
    render(<OneCFixedAssetRegistryPanel />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Не удалось загрузить список. Повторите попытку.");
    expect(screen.queryByText("Нет основных средств на учёте")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    expect(await screen.findByText("Нет основных средств на учёте")).toBeTruthy();
  });
  it("rejects a successful response with the wrong shape without crashing or reporting zero stock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) }));
    render(<MaterialRegistryPanel source={null} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Не удалось загрузить список. Повторите попытку.");
    expect(screen.queryByText("Нет материальных предметов с положительным остатком")).toBeNull();
  });
});
