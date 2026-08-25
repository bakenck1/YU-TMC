import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RegisterForm from "@/components/RegisterForm";

const { refreshSession } = vi.hoisted(() => ({
  refreshSession: vi.fn(),
}));

vi.mock("next/link", () => ({ default: "a" }));

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    refreshSession,
    logout: vi.fn(),
  }),
}));

const BOOTSTRAP_TOKEN = "bootstrap-secret-that-is-at-least-32-bytes";

function input(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected input #${id}`);
  }
  return element;
}

function fillValidForm() {
  fireEvent.change(input("bootstrap-token"), {
    target: { value: BOOTSTRAP_TOKEN },
  });
  fireEvent.change(input("first-name"), {
    target: { value: "First" },
  });
  fireEvent.change(input("last-name"), {
    target: { value: "Administrator" },
  });
  fireEvent.change(input("email"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(input("password"), {
    target: { value: "a-secure-password-123" },
  });
  fireEvent.change(input("confirm-password"), {
    target: { value: "a-secure-password-123" },
  });
}

describe("first administrator registration form", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    refreshSession.mockReset();
    refreshSession.mockResolvedValue(null);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("associates the bootstrap-token validation error with its input", () => {
    render(<RegisterForm />);

    fireEvent.click(
      screen.getByRole("button", { name: "auth.createAccount" }),
    );

    const bootstrapInput = input("bootstrap-token");
    expect(bootstrapInput.getAttribute("aria-invalid")).toBe("true");
    expect(bootstrapInput.getAttribute("aria-describedby")).toBe(
      "bootstrap-token-hint bootstrap-token-error",
    );
    expect(screen.getByText("auth.bootstrapTokenRequired")).toBeTruthy();

    for (const field of [
      { id: "bootstrap-token", errorId: "bootstrap-token-error" },
      { id: "first-name", errorId: "first-name-error" },
      { id: "last-name", errorId: "last-name-error" },
      { id: "email", errorId: "email-error" },
      { id: "password", errorId: "password-error" },
    ]) {
      const fieldInput = input(field.id);
      expect(
        document.querySelector(`label[for="${field.id}"]`),
      ).toBeTruthy();
      expect(fieldInput.getAttribute("aria-invalid")).toBe("true");
      expect(fieldInput.getAttribute("aria-describedby")).toContain(
        field.errorId,
      );
      expect(document.getElementById(field.errorId)?.getAttribute("role")).toBe(
        "alert",
      );
    }

    fireEvent.change(input("password"), {
      target: { value: "a-secure-password-123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "auth.createAccount" }),
    );
    const confirmationInput = input("confirm-password");
    expect(confirmationInput.getAttribute("aria-invalid")).toBe("true");
    expect(confirmationInput.getAttribute("aria-describedby")).toBe(
      "confirm-password-error",
    );
    expect(
      document.getElementById("confirm-password-error")?.getAttribute("role"),
    ).toBe("alert");
  });

  it("sends the bootstrap capability as a header and keeps it out of JSON and storage", async () => {
    const cookieBefore = document.cookie;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "registration_not_authorized" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RegisterForm />);
    fillValidForm();

    fireEvent.click(
      screen.getByRole("button", { name: "auth.createAccount" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;

    expect(headers.Authorization).toBe(`Bearer ${BOOTSTRAP_TOKEN}`);
    expect(body).not.toHaveProperty("bootstrapToken");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(cookieBefore);
    expect(screen.getByRole("alert").textContent).toContain(
      "auth.registrationNotAuthorized",
    );
  });

  it("shows a localized deployment error when the public origin is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "public_origin_not_configured" }),
      }),
    );
    render(<RegisterForm />);
    fillValidForm();

    fireEvent.click(
      screen.getByRole("button", { name: "auth.createAccount" }),
    );

    expect(
      await screen.findByText("auth.publicOriginNotConfigured"),
    ).toBeTruthy();
  });
});
