import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PushNotificationControl from "@/components/PushNotificationControl";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  fetchPushConfiguration,
  supportsWebPush,
} from "@/lib/client-push-subscription";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    language: (globalThis as { componentTestLanguage?: "en" | "kk" }).componentTestLanguage ?? "en",
    t: (key: string) => key,
  }),
}));
vi.mock("@/lib/client-push-subscription", () => ({
  supportsWebPush: vi.fn(), fetchPushConfiguration: vi.fn(), currentPushSubscription: vi.fn(),
  enablePushNotifications: vi.fn(), disablePushNotifications: vi.fn(), syncExistingPushSubscription: vi.fn(),
}));

describe("PushNotificationControl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (globalThis as { componentTestLanguage?: "en" | "kk" }).componentTestLanguage = "en";
    vi.mocked(supportsWebPush).mockReturnValue(true);
    vi.mocked(fetchPushConfiguration).mockResolvedValue({ configured: true, publicKey: "key" });
    vi.mocked(currentPushSubscription).mockResolvedValue(null as never);
    vi.mocked(enablePushNotifications).mockResolvedValue(undefined as never);
    vi.mocked(disablePushNotifications).mockResolvedValue(undefined);
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted" } });
  });

  it("renders unavailable states and enables/disables push from a user gesture", async () => {
    vi.mocked(supportsWebPush).mockReturnValue(false);
    const view = render(<PushNotificationControl hintKey="push.tmcHint" />);
    await screen.findByText("push.unsupported");

    vi.mocked(supportsWebPush).mockReturnValue(true);
    vi.mocked(fetchPushConfiguration).mockResolvedValue({ configured: true, publicKey: "key" });
    view.unmount();
    render(<PushNotificationControl hintKey="push.tmcHint" />);
    const enable = await screen.findByRole("button", { name: "push.enable" });
    expect(screen.getByRole("status").textContent).toContain("push.tmcHint");
    fireEvent.click(enable);
    await waitFor(() => expect(enablePushNotifications).toHaveBeenCalledWith("key", "en"));
    await screen.findByRole("button", { name: "push.enabled" });
    fireEvent.click(screen.getByRole("button", { name: "push.enabled" }));
    await waitFor(() => expect(disablePushNotifications).toHaveBeenCalledTimes(1));
  });

  it("keeps an error and busy guard observable", async () => {
    vi.mocked(enablePushNotifications).mockRejectedValue(new Error("push_permission_dismissed"));
    render(<PushNotificationControl />);
    const button = await screen.findByRole("button", { name: "push.enable" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText("push.dismissed");
    expect(enablePushNotifications).toHaveBeenCalledTimes(1);
  });

  it("discards a stale initialization after the language changes", async () => {
    let resolveFirst!: (value: { configured: boolean; publicKey: string | null }) => void;
    vi.mocked(fetchPushConfiguration)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ configured: false, publicKey: null });
    const view = render(<PushNotificationControl />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchPushConfiguration).toHaveBeenCalledTimes(1);
    (globalThis as { componentTestLanguage?: "en" | "kk" }).componentTestLanguage = "kk";
    view.rerender(<PushNotificationControl />);
    await screen.findByText("push.unconfigured");
    await act(async () => {
      resolveFirst({ configured: true, publicKey: "stale-key" });
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "push.enable" })).toBeNull();
  });

  it("does not let a stale enable completion overwrite a newer initialization", async () => {
    let resolveEnable!: () => void;
    vi.mocked(enablePushNotifications).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveEnable = resolve; }) as never,
    );
    const view = render(<PushNotificationControl />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole("button", { name: "push.enable" }));
    (globalThis as { componentTestLanguage?: "en" | "kk" }).componentTestLanguage = "kk";
    vi.mocked(fetchPushConfiguration).mockResolvedValue({ configured: false, publicKey: null });
    view.rerender(<PushNotificationControl />);
    await screen.findByText("push.unconfigured");
    await act(async () => {
      resolveEnable();
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "push.enabled" })).toBeNull();
  });
});
