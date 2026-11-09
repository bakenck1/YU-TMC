import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import UsersManager from "@/components/UsersManager";
import type { AppUser } from "@/lib/types";

vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ locale: "en-US", t: (key: string) => key }) }));
afterEach(() => vi.unstubAllGlobals());
const user: AppUser = { id: "stored-user", code: "U-1", fullName: "Persisted employee", email: "stored@example.test", phone: "", role: "employee", active: true, emailVerified: true, addedAt: "2026-11-01T00:00:00Z", version: 1 };

it("shows persisted users immediately and replaces the snapshot only when the background directory arrives", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  render(<UsersManager initialUsers={[user]} actorRole="admin" />);
  expect(screen.getByText(user.fullName)).toBeTruthy();
  await act(async () => { finish(Response.json({ users: [{ ...user, fullName: "Updated employee" }] })); });
  expect(await screen.findByText("Updated employee")).toBeTruthy();
  expect(screen.queryByText(user.fullName)).toBeNull();
});

it("keeps the persisted directory usable when background synchronization fails", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("directory unavailable"));
  vi.stubGlobal("fetch", fetcher);
  render(<UsersManager initialUsers={[user]} actorRole="admin" />);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(screen.getByText(user.fullName)).toBeTruthy();
});
