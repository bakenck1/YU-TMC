import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OneCPossibleMatches from "@/components/OneCPossibleMatches";
import type { PossibleCard } from "@/lib/server/one-c-possible-matches";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
const card: PossibleCard = {
  id: "card-1", name: "Скамья", inventoryNumber: "050-0002082", itemVersion: 3, itemSection: "general", reviewHash: "a".repeat(64),
  candidates: [{ code: "000245", balances: [
    { source: "MP", sourceId: "a", name: "Скамья №050-0002082-97", number: "050-0002082-97", price: "100", responsible: "Первый Сотрудник" },
    { source: "MP", sourceId: "b", name: "Скамья №050-0002082-97", number: "050-0002082-97", price: "200", responsible: "Второй Сотрудник" },
  ] }],
};

it("shows all balances under one code and sends reviewed version/hash only after confirmation", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [card] })).mockResolvedValueOnce(Response.json({ itemId: card.id }));
  vi.stubGlobal("fetch", fetcher);
  render(<OneCPossibleMatches />);
  fireEvent.click(screen.getByRole("button", { name: "Проверить возможные совпадения" }));
  fireEvent.click(await screen.findByRole("button", { name: "Выбрать код 000245" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/100 ₸ · Первый Сотрудник/)).toBeTruthy();
  expect(screen.getByText(/200 ₸ · Второй Сотрудник/)).toBeTruthy();
  expect(screen.getByText(/Этот код объединяет 2 строк/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить код" }));
  await screen.findByText("Нет совпадений, требующих подтверждения.");
  expect(fetcher.mock.calls[1][0]).toBe("/api/integrations/1c/possible");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ itemId: card.id, itemVersion: 3, reviewHash: card.reviewHash, code: "000245" });
  expect(refresh).toHaveBeenCalledOnce();
});

it("clears the old selection and asks for a new review when the server detects stale data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: [card] })).mockResolvedValueOnce(Response.json({ error: "one_c_possible_stale" }, { status: 409 })));
  render(<OneCPossibleMatches />);
  fireEvent.click(screen.getByRole("button", { name: "Проверить возможные совпадения" }));
  fireEvent.click(await screen.findByRole("button", { name: "Выбрать код 000245" }));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить код" }));
  await screen.findByText("Карточка или данные 1С изменились. Загрузите варианты заново.");
  expect(screen.queryByRole("region", { name: "Подтверждение связи" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Выбрать код 000245" })).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it("offers an IT card link instead of an unsupported code-confirmation action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: [{ ...card, itemSection: "it" }] })));
  render(<OneCPossibleMatches />);
  fireEvent.click(screen.getByRole("button", { name: "Проверить возможные совпадения" }));
  expect((await screen.findByRole("link", { name: "Открыть IT-карточку для проверки" })).getAttribute("href")).toBe("/it-items/card-1");
  expect(screen.queryByRole("button", { name: "Выбрать код 000245" })).toBeNull();
});
