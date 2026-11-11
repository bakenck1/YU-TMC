import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import OneCPossibleMatches from "@/components/OneCPossibleMatches";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
it("requires explicit confirmation, saves only the chosen card code, then refreshes analytics", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "card-1", name: "Скамья", inventoryNumber: "050-0002082", candidates: [{ name: "Скамья №050-0002082-97", code: "000245", number: "050-0002082-97", price: "100", responsible: "Сотрудник" }] }] })).mockResolvedValueOnce(Response.json({ updatedItemIds: ["card-1"] }));
  vi.stubGlobal("fetch", fetcher);
  render(<OneCPossibleMatches />);
  fireEvent.click(screen.getByRole("button", { name: "Проверить возможные совпадения" }));
  fireEvent.click(await screen.findByRole("button", { name: "Выбрать" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/100 ₸ · Сотрудник/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить связь" }));
  await screen.findByText("Нет совпадений, требующих подтверждения.");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ itemIds: ["card-1"], oneCCode: "000245" });
  expect(refresh).toHaveBeenCalledOnce();
});
