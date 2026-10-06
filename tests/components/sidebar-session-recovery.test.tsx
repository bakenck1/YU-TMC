import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SidebarContent from "@/components/SidebarContent";
import { translate } from "@/lib/i18n";
import type { AuthenticatedUser } from "@/lib/security/authorization";

const session = vi.hoisted(() => ({ user: null as AuthenticatedUser | null, loading: false,
  sessionError: false, refreshSession: vi.fn(), logout: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => session }));
vi.mock("next/navigation", () => ({ usePathname: () => "/items" }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({
  settings: { organizationName: "YU Inventory" }, t: (key: Parameters<typeof translate>[1]) => translate("ru", key),
}) }));
const props = { collapsed: false, showCollapseToggle: false };

describe("sidebar session recovery", () => {
  beforeEach(() => { session.user = null; session.loading = false; session.sessionError = false; vi.clearAllMocks(); });
  it("keeps authorized menu links visible while rechecking a verified user", () => {
    session.user = { email: "admin@example.test", name: "Admin", role: "admin" };
    session.loading = true;
    render(<SidebarContent {...props} />);
    expect(screen.getByRole("link", { name: "Список ТМЦ" }).getAttribute("href")).toBe("/items");
    expect(screen.getByRole("link", { name: "Настройки" })).not.toBeNull();
  });
  it("offers recovery when the initial session request fails instead of leaving an empty menu", () => {
    session.sessionError = true;
    render(<SidebarContent {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(session.refreshSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "Настройки" })).toBeNull();
  });
  it("offers sign-in after a definitive expired session", () => {
    render(<SidebarContent {...props} />);
    expect(screen.getByRole("link", { name: "Вход в систему" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("link", { name: "Настройки" })).toBeNull();
  });
});
