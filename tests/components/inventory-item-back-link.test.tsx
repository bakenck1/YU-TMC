import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import InventoryItemBackLink from "@/components/InventoryItemBackLink";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    replace,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
    replace?: boolean;
  }) => (
    <a href={href} data-replace={replace ? "true" : "false"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({
    t: (key: string) => key,
  }),
}));

describe("InventoryItemBackLink", () => {
  it("returns to the complete saved list state with a mobile-sized target", () => {
    const href = "/items?q=projector&brand=Epson&page=3";
    render(<InventoryItemBackLink href={href} />);

    const link = screen.getByRole("link", {
      name: "itemDetails.backToList",
    });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("data-replace")).toBe("true");
    expect(link.className).toContain("h-11");
    expect(link.className).toContain("w-11");
    expect(link.className).toContain("sm:w-auto");
    expect(screen.getByText("itemDetails.backToList").className).toContain(
      "sm:inline",
    );
  });
});
