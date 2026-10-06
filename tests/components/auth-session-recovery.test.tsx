import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthProvider, { useAuth } from "@/components/AuthProvider";

vi.mock("@/lib/client-push-subscription", () => ({ removePushSubscriptionBeforeLogout: async () => undefined }));
vi.mock("@/lib/search-history", () => ({ clearSensitiveSearchStorage: () => undefined }));
const user = { email: "admin@example.test", name: "Administrator", role: "admin" };
const reply = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });

function Probe() {
  const auth = useAuth();
  return <>
    <span data-testid="user">{auth.user?.name ?? "absent"}</span>
    <span data-testid="error">{String(auth.sessionError)}</span>
    <span data-testid="loading">{String(auth.loading)}</span>
    <button onClick={() => void auth.refreshSession()}>refresh</button>
    <button onClick={() => void auth.logout()}>logout</button>
  </>;
}
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe("session recovery without losing navigation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("recovers from an initial server failure automatically", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({ user }));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthProvider><Probe /></AuthProvider>);
    await settle();
    expect(screen.getByTestId("error").textContent).toBe("true");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByTestId("user").textContent).toBe(user.name);
    expect(screen.getByTestId("error").textContent).toBe("false");
  });

  it.each(["network", "server", "malformed"])("retains the verified user after a %s failure", async (failure) => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ user }));
    if (failure === "network") fetcher.mockRejectedValueOnce(new TypeError("network failed"));
    else fetcher.mockResolvedValueOnce(failure === "server" ? reply({}, 503) : reply({ user: { role: "admin" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthProvider><Probe /></AuthProvider>);
    await settle();
    fireEvent.click(screen.getByText("refresh"));
    await settle();
    expect(screen.getByTestId("user").textContent).toBe(user.name);
    expect(screen.getByTestId("error").textContent).toBe("true");
  });

  it("clears navigation permissions after a definitive unauthorized response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ user })).mockResolvedValueOnce(reply({}, 401)));
    render(<AuthProvider><Probe /></AuthProvider>);
    await settle();
    fireEvent.click(screen.getByText("refresh"));
    await settle();
    expect(screen.getByTestId("user").textContent).toBe("absent");
    expect(screen.getByTestId("error").textContent).toBe("false");
  });

  it("honors Retry-After and bounds automatic retries", async () => {
    const fetcher = vi.fn().mockImplementation(async () => reply({}, 429, { "retry-after": "60" }));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthProvider><Probe /></AuthProvider>);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("error").textContent).toBe("true");
  });

  it("bounds a stalled request and offers recovery instead of leaving navigation loading forever", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("error").textContent).toBe("true");
  });

  it("ignores a late session response after logout even if fetch ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ user }))
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
      .mockResolvedValueOnce(reply({}));
    vi.stubGlobal("fetch", fetcher);
    render(<AuthProvider><Probe /></AuthProvider>);
    await settle();
    fireEvent.click(screen.getByText("refresh"));
    fireEvent.click(screen.getByText("logout"));
    await settle();
    await act(async () => { resolve(reply({ user })); });
    expect(screen.getByTestId("user").textContent).toBe("absent");
  });
});
