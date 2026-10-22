import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OneCFixedAssetRegistryPanel from "@/components/OneCFixedAssetRegistryPanel";
import MaterialRegistryPanel from "@/components/MaterialRegistryPanel";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ language: "ru", locale: "ru-RU" }) }));

afterEach(() => vi.unstubAllGlobals());
const asset = { name: "Ноутбук Lenovo IdeaPad №2411/00390", code: "OS-42", inventoryNumber: null, barcode: "2411/00390", quantity: 1, initialCost: 450000, residualCost: 350000, location: "Подразделения", responsibleName: "Тынымбаев Бауыржан Анесович" };

describe("current 1C registry panels", () => {
  it("switches OS between on-book and all received statuses without losing owner search", async () => {
    const fetcher = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ data: [{ external_id: "os1", payload: { ...asset, status: "Снято с учёта" } }], total: 1, page: 1, pageSize: 50 }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<OneCFixedAssetRegistryPanel />);
    await screen.findByText(asset.name);
    fireEvent.click(screen.getByRole("button", { name: "Все статусы" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("scope=all"), expect.anything()));
    expect(await screen.findByText("Снято с учёта")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск основных средств"), { target: { value: "Тынымбаев" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("search=%D0%A2%D1%8B%D0%BD%D1%8B%D0%BC%D0%B1%D0%B0%D0%B5%D0%B2"), expect.anything()));
  });
  it("loads OS without another click and shows actual responsible person and costs", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ external_id: "os1", payload: asset }], total: 6500, page: 1, pageSize: 50 }) });
    vi.stubGlobal("fetch", fetcher);
    render(<OneCFixedAssetRegistryPanel />);
    expect(await screen.findByText(asset.name)).toBeTruthy();
    expect(screen.getByText(asset.responsibleName)).toBeTruthy();
    expect(screen.getByText("450 000", { exact: true, normalizer: value => value.replace(/\s/gu, " ") })).toBeTruthy();
    expect(screen.getByText("Страница 1 из 130")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск основных средств"), { target: { value: "Тынымбаев" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("search=%D0%A2%D1%8B%D0%BD%D1%8B%D0%BC%D0%B1%D0%B0%D0%B5%D0%B2"), { credentials: "same-origin", cache: "no-store" }));
  });

  it("loads MP automatically, then keeps the full-registry search while paging", async () => {
    const material = { name: "Материальный предмет №2411/00391", code: "MP-42", inventoryNumber: null, barcode: null, quantity: "3", unitPrice: "12000", responsibleName: asset.responsibleName };
    const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ data: [{ row_key: "m1", payload: material }], total: 101, page: Number(new URL(url, "https://local").searchParams.get("page")), pageSize: 50 }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<MaterialRegistryPanel source={null} />);
    expect(await screen.findByText(material.name)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Поиск материального предмета"), { target: { value: "2411/00391" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining("page=2&pageSize=50&search=2411%2F00391"), expect.anything()));
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
