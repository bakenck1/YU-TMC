import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";

import SettingsForm from "@/components/SettingsForm";

const { settingsContext } = vi.hoisted(() => ({
  settingsContext: {
    settings: {
      organizationName: "YU Inventory",
      language: "ru" as const,
      emailNotifications: true,
      pushNotifications: false,
      maintenanceAlerts: true,
    },
    language: "ru" as const,
    notificationLoading: [] as string[],
    organizationSaving: false,
    t: (key: string) => key,
    changeLanguage: vi.fn(),
    changeNotification: vi.fn(),
    saveOrganizationName: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => settingsContext,
}));

describe("settings form", () => {
  beforeEach(() => {
    settingsContext.settings.organizationName = "YU Inventory";
    settingsContext.settings.language = "ru";
    settingsContext.settings.emailNotifications = true;
    settingsContext.settings.pushNotifications = false;
    settingsContext.settings.maintenanceAlerts = true;
    settingsContext.notificationLoading = [];
    settingsContext.organizationSaving = false;
    settingsContext.changeLanguage.mockReset();
    settingsContext.changeNotification.mockReset();
    settingsContext.saveOrganizationName.mockReset().mockResolvedValue(true);
  });

  it("blocks empty organization names before making a save request", () => {
    render(<SettingsForm />);

    const organizationInput = document.getElementById("settings-organization-name");
    if (!(organizationInput instanceof HTMLInputElement)) throw new Error("Organization input not found");
    fireEvent.change(organizationInput, {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.saveChanges" }));

    expect(settingsContext.saveOrganizationName).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "settings.organizationRequired",
    );
    expect(
      organizationInput.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("does not replace newer input when a save resolves", async () => {
    let resolveSave!: (value: boolean) => void;
    settingsContext.saveOrganizationName.mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveSave = resolve; }),
    );
    render(<SettingsForm />);

    const organizationInput = document.getElementById("settings-organization-name");
    if (!(organizationInput instanceof HTMLInputElement)) throw new Error("Organization input not found");
    fireEvent.change(organizationInput, { target: { value: "First name" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.saveChanges" }));
    fireEvent.change(organizationInput, { target: { value: "Newer input" } });

    resolveSave(true);
    await waitFor(() => expect(organizationInput.value).toBe("Newer input"));
  });
});
