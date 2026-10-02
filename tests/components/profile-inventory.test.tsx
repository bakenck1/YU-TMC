import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "@/app/(protected)/profile/page";
import UserProfileCard from "@/components/UserProfileCard";
import type { UserDto } from "@/lib/contracts/users";
import type { InventoryItem } from "@/lib/types";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { STORY_ITEM_DTO } from "@/stories/inventory-fixtures";
import { USERS } from "@/stories/fixtures";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  requireAuthorizedPage: vi.fn(),
  getProfile: vi.fn(),
  listOwnItems: vi.fn(),
  listActiveGroupsAssignedTo: vi.fn(),
  getDistribution: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/profile",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/server/security/page-access", () => ({
  requireAuthorizedPage: mocks.requireAuthorizedPage,
}));
vi.mock("@/lib/server/security/request-user", () => ({
  authorizationActor: (user: { userId: string; role: string }) => ({
    userId: user.userId, role: user.role,
  }),
}));
vi.mock("@/lib/server/application", () => ({
  getApplicationServices: () => ({
    users: { getProfile: mocks.getProfile },
    items: { listOwnItems: mocks.listOwnItems },
    localBarcodes: {
      listActiveGroupsAssignedTo: mocks.listActiveGroupsAssignedTo,
      getDistribution: mocks.getDistribution,
    },
  }),
}));

const baseItem = toInventoryItemView(STORY_ITEM_DTO);
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

const items: InventoryItem[] = [
  { ...baseItem, id: "active", name: "Active item", quantity: 3, price: 100 },
  { ...baseItem, id: "service", name: "Service item", status: "maintenance", quantity: 2, price: 50 },
  { ...baseItem, id: "written-off", name: "Written-off item", status: "decommissioned", quantity: 10, price: 0 },
  { ...baseItem, id: "group", localGroupId: "group", name: "Local group", quantity: 1, price: 25 },
];

describe("personal inventory cards", () => {
  it("opens the list directly after the selected card and switches immediately", async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<UserProfileCard profile={USERS[2]} items={items} />);
    const totalValue = screen.getByRole("button", { name: /items.summaryTotalValue/ });
    await user.click(totalValue);
    const valuePanel = screen.getByRole("region", { name: "items.summaryTotalValue" });
    expect(totalValue.nextElementSibling).toBe(valuePanel);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });

    const maintenance = screen.getByRole("button", { name: /items.summaryMaintenance/ });
    await user.click(maintenance);
    expect(screen.queryByRole("region", { name: "items.summaryTotalValue" })).toBeNull();
    const servicePanel = screen.getByRole("region", { name: "items.summaryMaintenance" });
    expect(maintenance.nextElementSibling).toBe(servicePanel);
    expect(within(servicePanel).getAllByRole("link")).toHaveLength(1);
    expect(within(servicePanel).getByRole("link", { name: "Service item" })).toBeTruthy();
    await user.click(within(servicePanel).getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("region", { name: "items.summaryMaintenance" })).toBeNull();
    expect(document.activeElement).toBe(maintenance);
  });

  it.each([USERS[0], USERS[2]])("expands, filters and closes all four cards for $role", async (profile) => {
    const user = userEvent.setup();
    render(<UserProfileCard profile={profile} items={items} />);
    expect(screen.getByRole("heading", { name: "profile.inventoryTitle" })).toBeTruthy();
    const cases = [
      ["items.summaryTotalValue", "425 common.currency", 4],
      ["items.summaryTotalItems", "16 common.unitShort", 4],
      ["items.summaryMaintenance", "2 common.unitShort", 1],
      ["items.summaryDecommissioned", "1 common.unitShort", 1],
    ] as const;
    for (const [title, value, count] of cases) {
      const button = screen.getByRole("button", { name: new RegExp(title) });
      expect(within(button).getByText(value)).toBeTruthy();
      await user.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      const region = await screen.findByRole("region", { name: new RegExp(title) });
      expect(within(region).getAllByRole("link")).toHaveLength(count);
      await user.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      await vi.waitFor(() => expect(screen.queryByRole("region", { name: new RegExp(title) })).toBeNull());
    }
  });

  it("opens ordinary and local-group item details with a return link to the profile", async () => {
    const user = userEvent.setup();
    render(<UserProfileCard profile={USERS[0]} items={items} />);
    await user.click(screen.getByRole("button", { name: /items.summaryTotalItems/ }));
    for (const [name, path] of [["Active item", "/items/active"], ["Local group", "/local-barcodes/group"]]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(`${path}?returnTo=%2Fprofile`);
      await user.click(link.closest("tr")!);
      expect(mocks.push).toHaveBeenLastCalledWith(`${path}?returnTo=%2Fprofile`);
    }
  });

  it("shows zero totals and an empty list for an account without inventory", async () => {
    const user = userEvent.setup();
    render(<UserProfileCard profile={USERS[2]} items={[]} />);
    const button = screen.getByRole("button", { name: /items.summaryTotalItems/ });
    expect(within(button).getByText("0 common.unitShort")).toBeTruthy();
    await user.click(button);
    expect(screen.getByText("items.empty")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("profile inventory loading", () => {
  beforeEach(() => {
    mocks.listActiveGroupsAssignedTo.mockResolvedValue([]);
    mocks.listOwnItems.mockResolvedValue([]);
  });

  it.each(USERS)("uses the authenticated $role account and subtracts allocated quantities", async (profile: UserDto) => {
    const actor = { userId: profile.id, role: profile.role };
    mocks.requireAuthorizedPage.mockResolvedValue(actor);
    mocks.getProfile.mockResolvedValue(profile);
    mocks.listOwnItems.mockResolvedValue([
      { ...STORY_ITEM_DTO, id: "remaining", quantity: 10 },
      { ...STORY_ITEM_DTO, id: "fully-transferred", quantity: 5 },
    ]);
    mocks.getDistribution.mockImplementation(async (id: string) => ({
      originalRemainder: id === "remaining" ? 3 : 0,
    }));
    const group = {
      id: "own-group", itemId: "remaining", itemName: "Own allocation",
      itemType: "furniture", localBarcode: "LOCAL-1", quantity: 2, unitPrice: 100,
      responsible: { id: profile.id, fullName: profile.fullName },
      location: { buildingId: "building-1", buildingName: "Main", roomId: "room-1", roomDesignation: "101" },
      transferredAt: "2026-10-02T08:00:00Z", status: "active", version: 1,
    };
    mocks.listActiveGroupsAssignedTo.mockResolvedValue([group]);

    const result = await ProfilePage();
    expect(mocks.requireAuthorizedPage).toHaveBeenCalledWith("/profile");
    expect(mocks.getProfile).toHaveBeenCalledWith(profile.id);
    expect(mocks.listOwnItems).toHaveBeenCalledWith(actor);
    expect(mocks.listActiveGroupsAssignedTo).toHaveBeenCalledWith(actor);
    expect(mocks.getDistribution).toHaveBeenCalledWith("remaining", actor);
    expect(result.props.items.map((item: InventoryItem) => [item.id, item.quantity])).toEqual([
      ["remaining", 3], ["own-group", 2],
    ]);
  });
});
