import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoomBookingCard from "@/components/RoomBookingCard";
import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import { translate, type TranslationKey } from "@/lib/i18n";

vi.mock("@/components/AppSettingsProvider", () => ({
  useAppSettings: () => ({ t: (key: TranslationKey) => translate("ru", key) }),
}));
vi.mock("@/components/ProblemReportButton", () => ({ default: () => null }));

const available = { status: "available", href: "https://booking.example/?room=tmc_11111111-1111-4111-8111-111111111111" } as const;
const room = { access: "full", id: "11111111-1111-4111-8111-111111111111", designation: "201", responsibleName: null, items: [] } as const;

describe("room booking", () => {
  it("explains prelaunch without a broken external link", () => {
    render(<RoomBookingCard booking={{ status: "coming_soon" }} />);
    expect(screen.getByText("Скоро")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Записаться в кабинет" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toContain("скоро");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers a normal same-tab link to the exact selected office", () => {
    render(<RoomBookingCard booking={available} />);
    const link = screen.getByRole("link", { name: "Записаться в кабинет" });
    expect(link.getAttribute("href")).toBe(available.href);
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.queryByText("Скоро")).toBeNull();
  });

  it("places booking immediately after room information and before inventory", () => {
    const { container } = render(<RoomWorkspaceView room={{ ...room, items: [] }} authenticated returnTo="/rooms/room" booking={available} />);
    const main = container.querySelector("main")!;
    expect(main.children[0].textContent).toContain("201");
    expect(main.children[1].getAttribute("aria-label")).toBe("Онлайн-запись");
    expect(main.children[2].textContent).toContain("Всего ТМЦ");
  });

  it.each(["authentication_required", "denied"] as const)("preserves %s privacy even when passed a booking link", (access) => {
    render(<RoomWorkspaceView room={access === "denied" ? { access, items: [] } : { access }} authenticated={access === "denied"} returnTo="/rooms/qr/private" booking={available} />);
    expect(screen.queryByRole("link", { name: "Записаться в кабинет" })).toBeNull();
    expect(screen.queryByText("201")).toBeNull();
  });

  it("does not render an unavailable or unpublished service", () => {
    const { container } = render(<RoomBookingCard booking={{ status: "hidden" }} />);
    expect(container.textContent).toBe("");
  });
});
