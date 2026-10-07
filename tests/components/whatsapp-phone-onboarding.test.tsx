import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import WhatsAppPhonePage from "@/app/whatsapp-phone/page";
import UserFormModal from "@/components/UserFormModal";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

const { currentUser, redirect } = vi.hoisted(() => ({ currentUser: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/server/security/request-user", () => ({ requireCurrentUserToken: currentUser }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: string) => key }) }));

it("allows authenticated pages even with a legacy phone-required flag", async () => {
  const actor = { userId: "employee", role: "employee", whatsappPhoneRequired: true };
  currentUser.mockResolvedValue(actor);
  expect(await requireAuthenticatedPage()).toEqual(actor);
  expect(redirect).not.toHaveBeenCalled();
});

it("redirects the retired WhatsApp page to the user's home", async () => {
  currentUser.mockResolvedValue({ userId: "admin", role: "admin", whatsappPhoneRequired: true });
  await expect(WhatsAppPhonePage()).rejects.toThrow("redirect:/profile");
});

it("does not request a phone when creating a user", () => {
  const { container } = render(<UserFormModal user={null} roleOptions={["employee", "admin"]} suggestedCode="00001" onClose={vi.fn()} onSave={vi.fn()} />);
  expect(container.querySelector('input[type="tel"]')).toBeNull();
  expect(screen.queryByText("users.phone")).toBeNull();
});
