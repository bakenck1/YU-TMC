import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhatsAppPhoneForm from "@/components/WhatsAppPhoneForm";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ logout: mocks.logout }) }));
beforeEach(() => { vi.unstubAllGlobals(); });

it("requires a phone and offers no skip or work navigation", () => {
  render(<WhatsAppPhoneForm />);
  const input = screen.getByRole("textbox", { name: "Ваш номер WhatsApp" }) as HTMLInputElement;
  expect(input.required).toBe(true);
  expect(input.value).toBe("");
  expect((screen.getByRole("button", { name: "Сохранить и продолжить" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps access blocked and explains an unregistered number", async () => {
  const fetch = vi.fn(async () => Response.json({ error: "whatsapp_not_registered" }, { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  render(<WhatsAppPhoneForm />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "+7 701 111 22 33" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("На этом номере нет WhatsApp"));
  expect(fetch).toHaveBeenCalledWith("/api/auth/whatsapp-phone", expect.objectContaining({ method: "POST", body: JSON.stringify({ phone: "+7 701 111 22 33" }) }));
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("shows a recoverable error when the gateway cannot check the number", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "whatsapp_check_unavailable" }, { status: 503 })));
  render(<WhatsAppPhoneForm />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "77011112233" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("номер пока не сохранён"));
  expect((screen.getByRole("button", { name: "Сохранить и продолжить" }) as HTMLButtonElement).disabled).toBe(false);
});

it("allows signing out without entering a phone", async () => {
  mocks.logout.mockResolvedValue(undefined);
  render(<WhatsAppPhoneForm />);
  fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  expect(mocks.logout).toHaveBeenCalledOnce();
});
