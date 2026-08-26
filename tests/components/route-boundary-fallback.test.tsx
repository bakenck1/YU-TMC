import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RouteBoundaryFallback from "@/components/RouteBoundaryFallback";
import RouteLoadingFallback from "@/components/RouteLoadingFallback";
import { CLIENT_SETTINGS_CHANGE_EVENT } from "@/lib/client-language";
import { translate } from "@/lib/i18n";

describe("route boundary fallback", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "en";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shows a localized recovery action without exposing the error message", () => {
    const retry = vi.fn();
    render(
      <RouteBoundaryFallback
        error={new Error("database password must not be shown")}
        retry={retry}
      />,
    );

    expect(screen.getByRole("heading", { name: "The page could not be loaded" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "The page could not be loaded" })).toBeTruthy();
    expect(screen.getByText("Something unexpected happened. Try loading the page again.")).toBeTruthy();
    expect(screen.queryByText("database password must not be shown")).toBeNull();
    const loggedArguments = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(loggedArguments).not.toContain("database password must not be shown");
    expect(loggedArguments).not.toContain("Error:");
    expect(screen.queryByRole("main")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses the global copy when the root layout itself fails", () => {
    window.localStorage.setItem(
      "yu-inventory-settings-v1",
      JSON.stringify({
        organizationName: "YU Inventory",
        language: "kk",
        emailNotifications: true,
        pushNotifications: false,
        maintenanceAlerts: true,
      }),
    );
    render(<RouteBoundaryFallback global retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: translate("kk", "error.globalTitle") }),
    ).toBeTruthy();
    expect(screen.getByText(translate("kk", "error.globalDescription"))).toBeTruthy();
    expect(
      screen.getByRole("button", { name: translate("kk", "error.reload") }),
    ).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("updates an already mounted fallback after a same-tab language change", async () => {
    window.localStorage.setItem(
      "yu-inventory-settings-v1",
      JSON.stringify({
        organizationName: "YU Inventory",
        language: "en",
        emailNotifications: true,
        pushNotifications: false,
        maintenanceAlerts: true,
      }),
    );
    render(<RouteBoundaryFallback retry={vi.fn()} />);
    expect(screen.getByRole("heading", { name: translate("en", "error.title") })).toBeTruthy();

    window.localStorage.setItem(
      "yu-inventory-settings-v1",
      JSON.stringify({
        organizationName: "YU Inventory",
        language: "kk",
        emailNotifications: true,
        pushNotifications: false,
        maintenanceAlerts: true,
      }),
    );
    window.dispatchEvent(new Event(CLIENT_SETTINGS_CHANGE_EVENT));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: translate("kk", "error.title") })).toBeTruthy();
    });
  });

  it("localizes the loading fallback from the active browser language", () => {
    window.localStorage.setItem(
      "yu-inventory-settings-v1",
      JSON.stringify({
        organizationName: "YU Inventory",
        language: "en",
        emailNotifications: true,
        pushNotifications: false,
        maintenanceAlerts: true,
      }),
    );
    render(<RouteLoadingFallback />);

    expect(screen.getByText("Loading")).toBeTruthy();
  });
});
