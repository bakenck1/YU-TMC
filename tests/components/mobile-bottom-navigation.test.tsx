import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MobileBottomNavigation from "@/components/MobileBottomNavigation";
import type { UserRole } from "@/lib/contracts/users";
import { translate } from "@/lib/i18n";

const state = vi.hoisted(() => ({ role: "employee" as UserRole, pathname: "/profile" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: Parameters<typeof translate>[1]) => translate("ru", key) }),
}));

describe("mobile bottom navigation", () => {
  beforeEach(() => { state.role = "employee"; state.pathname = "/profile"; });

  it("keeps employee destinations and full accessible names with short visible labels", () => {
    render(<MobileBottomNavigation />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/items", "/scan", "/requests", "/profile"]);
    expect(screen.getByRole("link", { name: translate("ru", "nav.scanQr") }).textContent).toBe(translate("ru", "nav.mobileScan"));
    expect(screen.getByRole("link", { name: translate("ru", "nav.items") }).textContent).toBe(translate("ru", "nav.mobileItems"));
    expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toEqual([links[3]]);
  });

  it("marks the inventory destination active on item details", () => {
    state.pathname = "/items/item-1";
    render(<MobileBottomNavigation />);
    expect(screen.getByRole("link", { name: translate("ru", "nav.items") }).getAttribute("aria-current")).toBe("page");
  });

  it.each(["admin", "warehouse", "typography", "passport_author", "passport_reviewer"] as const)("preserves navigation access for %s", (role) => {
    state.role = role;
    render(<MobileBottomNavigation />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/scan");
    if (role === "typography") expect(hrefs).toEqual(["/inventory", "/scan"]);
    else expect(hrefs).toContain("/items");
    expect(hrefs.includes("/room-passports")).toBe(["admin", "passport_author", "passport_reviewer"].includes(role));
  });
});
