import { fireEvent,render,screen } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";

import RouteBoundaryFallback from "@/components/RouteBoundaryFallback";

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

    expect(screen.queryByText("database password must not be shown")).toBeNull();
    const loggedArguments = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(loggedArguments).not.toContain("database password must not be shown");
    expect(loggedArguments).not.toContain("Error:");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses the global copy when the root layout itself fails", () => {
    const retry = vi.fn();
    render(<RouteBoundaryFallback global retry={retry} error={new Error("secret global failure")} />);
    expect(screen.queryByText("secret global failure")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

});
