import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppSettingsProvider from "@/components/AppSettingsProvider";
import SettingsForm from "@/components/SettingsForm";
import type { AppSettings } from "@/lib/app-settings";
import { translate } from "@/lib/i18n";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
}));

vi.mock("@/lib/client-push-subscription", () => ({
  syncPushSubscriptionLanguage: vi.fn().mockResolvedValue(undefined),
}));

const fetchMock = vi.fn<typeof fetch>();

let serverSettings: AppSettings;
let patches: Array<Partial<AppSettings>>;

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AppSettingsProvider persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    serverSettings = {
      organizationName: "YU Inventory",
      language: "ru",
      emailNotifications: true,
      pushNotifications: false,
      maintenanceAlerts: true,
    };
    patches = [];
    fetchMock.mockReset().mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body)) as Partial<AppSettings>;
        patches.push(patch);
        serverSettings = { ...serverSettings, ...patch };
      }
      return jsonResponse(serverSettings);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists organization and notification settings through the real provider", async () => {
    render(
      <AppSettingsProvider>
        <SettingsForm />
      </AppSettingsProvider>,
    );

    const organizationInput = await screen.findByDisplayValue("YU Inventory") as HTMLInputElement;
    fireEvent.change(organizationInput, { target: { value: "  Campus inventory  " } });
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("ru", "settings.saveChanges"),
      }),
    );

    await waitFor(() => {
      expect(patches).toContainEqual({ organizationName: "Campus inventory" });
    });
    await waitFor(() => expect((organizationInput as HTMLInputElement).value).toBe("Campus inventory"));

    fireEvent.click(
      screen.getByRole("switch", {
        name: translate("ru", "settings.emailNotifications"),
      }),
    );

    await waitFor(() => {
      expect(patches).toContainEqual({ emailNotifications: false });
    });
    await waitFor(() => {
      expect(screen.getByRole("switch", {
        name: translate("ru", "settings.emailNotifications"),
      }).getAttribute("aria-checked")).toBe("false");
    });

    expect(JSON.parse(window.localStorage.getItem("yu-inventory-settings-v1") ?? "null"))
      .toMatchObject({
        organizationName: "Campus inventory",
        emailNotifications: false,
      });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  });
});
