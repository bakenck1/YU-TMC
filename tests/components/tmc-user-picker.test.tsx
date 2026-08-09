import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TmcUserPicker from "@/components/TmcUserPicker";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: string) => key }),
}));

const FIRST = { id: "11111111-1111-4111-8111-111111111111", fullName: "Ada Lovelace", email: "ada@example.test", role: "employee" as const };
const SECOND = { id: "22222222-2222-4222-8222-222222222222", fullName: "Bauyrzhan User", email: "bau@example.test", role: "warehouse" as const };

describe("TmcUserPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.useRealTimers());

  it("does not query short input, debounces valid input, and selects through the keyboard", async () => {
    const onChange = vi.fn();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ users: [FIRST, SECOND] }) } as Response);
    render(<TmcUserPicker value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "a" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("tmc.recipient.minChars");

    fireEvent.change(input, { target: { value: "ad" } });
    expect(screen.getByRole("status").textContent).toContain("tmc.recipient.loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/inventory/transfer-recipient-candidates?q=ad",
      expect.anything(),
    );
    expect(screen.getByRole("option", { name: /Ada Lovelace/ })).not.toBeNull();
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(SECOND);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("drops a stale response and clears the controlled value", async () => {
    const onChange = vi.fn();
    let resolveFirst!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [SECOND] }) } as Response);
    const { rerender } = render(<TmcUserPicker value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ad" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(input, { target: { value: "ba" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole("option", { name: /Bauyrzhan/ })).not.toBeNull();
    await act(async () => {
      resolveFirst({ ok: true, json: async () => ({ users: [FIRST] }) } as Response);
      await Promise.resolve();
    });
    expect(screen.queryByRole("option", { name: /Ada Lovelace/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "tmc.recipient.clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(<TmcUserPicker value={SECOND} onChange={onChange} />);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Bauyrzhan User");
  });
});
