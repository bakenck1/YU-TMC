import AnalyticsPage from "@/app/(protected)/analytics/page";
import { STORY_ITEM_DTO } from "@/stories/inventory-fixtures";
import { fireEvent,render,screen,within } from "@testing-library/react";
import { afterEach,beforeEach,expect,it,vi } from "vitest";

vi.mock("@/lib/server/security/page-access", () => ({ requireAuthorizedPage: async () => ({ userId: "warehouse", role: "warehouse", sessionVersion: 1 }) }));
vi.mock("@/lib/server/security/request-user", () => ({ authorizationActor: (user: unknown) => user }));
vi.mock("@/lib/server/application", () => ({ getApplicationServices: () => ({ items: { listItems: async () => records } }) }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ locale: "en-US", dataLabel: (value: string) => value, t: (key: string) => key }) }));

const records = (["active", "maintenance", "decommissioned", "decommissioned_in_use"] as const).map((status, index) => ({
  ...STORY_ITEM_DTO, id: `item-${index}`, name: `Asset ${status}`, status, quantity: 1,
}));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it("lets analytics users open inventory records for every lifecycle status", async () => {
  render(await AnalyticsPage());
  for (const record of records) {
    fireEvent.doubleClick(screen.getByRole("button", { name: new RegExp(`^${record.status}(?![a-z_])`) }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/items/${record.id}`]);
    fireEvent.click(within(dialog).getByRole("button", { name: "common.close" }));
  }
});
