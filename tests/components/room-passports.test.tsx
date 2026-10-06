import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoomPassportList from "@/components/RoomPassportList";
import RoomPassportCard from "@/components/RoomPassportCard";
import RoomWorkspaceView from "@/components/RoomWorkspaceView";
import type { RoomPassportDto } from "@/lib/contracts/room-passports";
import { translate, type TranslationKey } from "@/lib/i18n";

const state = vi.hoisted(() => ({ language: "ru" as "ru" | "kk" | "en" }));
vi.mock("@/components/AppSettingsProvider", () => ({ useAppSettings: () => ({ t: (key: TranslationKey) => translate(state.language, key), dataLabel: (value: string) => value }) }));
vi.mock("@/components/ProblemReportButton", () => ({ default: () => null }));
const passport: RoomPassportDto = { roomId: "room1", buildingId: "building1", buildingName: "Main", floorNumber: 1, floorLabel: null, designation: "101", status: "not_started", version: 0, file: null, uploadedBy: null, submittedBy: null, rejectionReason: null, rejectionComment: null, actions: ["start"] };
beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => { vi.unstubAllGlobals(); state.language = "ru"; });

describe("room passports", () => {
  it("combines filters, resets dependent selections and shows an empty result", () => {
    const passports = [passport, { ...passport, roomId: "room2", designation: "202", floorNumber: 2, status: "approved" as const }, { ...passport, roomId: "room3", designation: "303", buildingId: "building2", buildingName: "Other" }];
    render(<RoomPassportList passports={passports} />);
    fireEvent.change(screen.getByLabelText("Корпус"), { target: { value: "building1" } });
    fireEvent.change(screen.getByLabelText("Этаж"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Кабинет"), { target: { value: "room2" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const roomLink = screen.getByRole("link", { name: "Открыть паспорт: 202 · Main · Этаж: 2 · Готово" });
    const destination = new URL(roomLink.getAttribute("href")!, window.location.origin);
    expect(destination.pathname).toBe("/room-passports/room2");
    expect(destination.searchParams.get("returnTo")).toBe("/room-passports?building=building1&floor=2&room=room2");
    expect(roomLink.querySelector("h2")?.textContent).toBe("202");
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "not_started" } });
    expect(screen.getByRole("status").textContent).toContain("не найдены");
    fireEvent.change(screen.getByLabelText("Корпус"), { target: { value: "building2" } });
    expect((screen.getByLabelText("Этаж") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Кабинет") as HTMLSelectElement).value).toBe("");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
  it("restores every filter through the card back link, reload and browser history", () => {
    window.history.replaceState(null, "", "/room-passports");
    const passports = [passport, { ...passport, roomId: "review", designation: "202", floorNumber: 0, status: "in_review" as const, actions: ["return" as const] }];
    const list = render(<RoomPassportList passports={passports} prioritizeReview />);
    fireEvent.change(screen.getByLabelText("Корпус"), { target: { value: "building1" } });
    fireEvent.change(screen.getByLabelText("Этаж"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Кабинет"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "На проверке 1" }));
    const selectedHref = "/room-passports?building=building1&floor=0&room=review&status=in_review";
    expect(`${window.location.pathname}${window.location.search}`).toBe(selectedHref);
    const details = new URL(screen.getByRole("link", { name: /Открыть паспорт: 202/ }).getAttribute("href")!, window.location.origin);
    expect(details.searchParams.get("returnTo")).toBe(selectedHref);
    list.unmount();
    window.history.pushState(null, "", `${details.pathname}${details.search}`);
    const card = render(<RoomPassportCard initialPassport={passports[1]} returnHref={details.searchParams.get("returnTo")!} />);
    const backHref = screen.getByRole("link", { name: /К списку паспортов/ }).getAttribute("href")!;
    expect(backHref).toBe(selectedHref);
    card.unmount();
    window.history.pushState(null, "", backHref);
    const restored = render(<RoomPassportList passports={passports} prioritizeReview />);
    for (const [label, value] of [["Корпус", "building1"], ["Этаж", "0"], ["Кабинет", "review"], ["Статус", "in_review"]]) {
      expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe(value);
    }
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(window.location.search).toBe("");
    act(() => {
      window.history.replaceState(null, "", selectedHref);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((screen.getByLabelText("Статус") as HTMLSelectElement).value).toBe("in_review");
    restored.unmount();
    render(<RoomPassportList passports={passports.map(row => row.roomId === "review" ? { ...row, status: "approved" } : row)} prioritizeReview />);
    expect((screen.getByLabelText("Статус") as HTMLSelectElement).value).toBe("in_review");
    expect(screen.getByRole("status").textContent).toContain("не найдены");
  });
  it("drops stale dependent location filters and makes unsafe card return links local", () => {
    window.history.replaceState(null, "", "/room-passports?building=building1&floor=1&room=room1&status=in_progress");
    const list = render(<RoomPassportList passports={[passport]} />);
    expect((screen.getByLabelText("Кабинет") as HTMLSelectElement).value).toBe("room1");
    list.rerender(<RoomPassportList passports={[]} />);
    for (const label of ["Корпус", "Этаж", "Кабинет"]) expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe("");
    expect(window.location.search).toBe("?status=in_progress");
    list.rerender(<RoomPassportList passports={[passport]} />);
    for (const label of ["Корпус", "Этаж", "Кабинет"]) expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe("");
    list.unmount();
    render(<RoomPassportCard initialPassport={passport} returnHref="//example.com/room-passports" />);
    expect(screen.getByRole("link", { name: /К списку паспортов/ }).getAttribute("href")).toBe("/room-passports");
  });
  it("puts completed passports last for authors and review work first for reviewers, preserving filters", () => {
    const passports = [
      { ...passport, roomId: "done", designation: "Done room", status: "approved" as const },
      { ...passport, roomId: "work", designation: "Draft room", status: "in_progress" as const },
      { ...passport, roomId: "review", designation: "Review room", status: "in_review" as const },
      { ...passport, roomId: "other", designation: "Other review", buildingId: "building2", buildingName: "Other", status: "in_review" as const },
    ];
    const originalOrder = passports.map(row => row.roomId);
    const { rerender } = render(<RoomPassportList passports={passports} />);
    expect(screen.getAllByRole("article").map(row => row.querySelector("h2")?.textContent)).toEqual(["Draft room", "Review room", "Other review", "Done room"]);
    expect(screen.queryByRole("button", { name: "На проверке 2" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "approved" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Done room" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(screen.getAllByRole("article").map(row => row.querySelector("h2")?.textContent)).toEqual(["Draft room", "Review room", "Other review", "Done room"]);
    rerender(<RoomPassportList passports={passports} prioritizeReview />);
    expect(screen.getAllByRole("article").map(row => row.querySelector("h2")?.textContent)).toEqual(["Review room", "Other review", "Draft room", "Done room"]);
    fireEvent.change(screen.getByLabelText("Корпус"), { target: { value: "building1" } });
    const queue = screen.getByRole("button", { name: "На проверке 1" });
    fireEvent.click(queue);
    expect(queue.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Review room" })).toBeTruthy();
    fireEvent.click(queue);
    expect(screen.getAllByRole("article").map(row => row.querySelector("h2")?.textContent)).toEqual(["Review room", "Draft room", "Done room"]);
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "approved" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Done room" })).toBeTruthy();
    expect(passports.map(row => row.roomId)).toEqual(originalOrder);
  });
  for (const language of ["ru", "kk", "en"] as const) it(`renders passport labels and latest feedback in ${language}`, () => {
    state.language = language;
    render(<RoomPassportCard initialPassport={{ ...passport, status: "needs_correction", rejectionReason: "incorrect", rejectionComment: "Update room", actions: ["upload"] }} />);
    expect(screen.getByText(`2. ${translate(language, "passport.status.needs_correction")}`)).toBeTruthy();
    expect(screen.getByText(translate(language, "passport.reason.incorrect"))).toBeTruthy();
    expect(screen.getByText("Update room")).toBeTruthy();
    expect(screen.getByLabelText(translate(language, "passport.uploadCorrection"))).toBeTruthy();
    expect(screen.getByText(translate(language, "passport.correctionHint"))).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
  it("guides a rejected passport through corrected upload and explicit resubmission", async () => {
    const rejected = { ...passport, status: "needs_correction" as const, version: 4, rejectionReason: "incorrect" as const, rejectionComment: "Fix room number", actions: ["upload" as const] };
    const corrected = { ...rejected, status: "in_progress" as const, version: 5, file: { id: "file", name: "corrected.pdf", size: 100, url: "/file?id=file" }, actions: ["upload", "delete", "submit"] as RoomPassportDto["actions"] };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ passport: corrected })).mockResolvedValueOnce(Response.json({ passport: { ...corrected, status: "in_review", version: 6, actions: ["return"] } }));
    vi.stubGlobal("fetch", fetch);
    render(<RoomPassportCard initialPassport={rejected} />);
    expect(screen.queryByRole("button", { name: "Отправить на проверку" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Загрузить исправленный PDF"), { target: { files: [new File(["%PDF-test"], "corrected.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(screen.getByText(translate("ru", "passport.correctionSaved"))).toBeTruthy());
    expect(screen.queryByText("2. Отклонено")).toBeNull();
    expect(screen.getByText("Fix room number")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    await waitFor(() => expect(screen.getByText("3. На проверке")).toBeTruthy());
    expect(screen.getByText("Fix room number")).toBeTruthy();
    expect(screen.queryByText(translate("ru", "passport.correctionSaved"))).toBeNull();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "submit", version: 5 });
  });
  for (const language of ["ru", "kk", "en"] as const) it(`explains waiting for review to the sender and colleagues in ${language}`, () => {
    state.language = language;
    const submitted = { ...passport, status: "in_review" as const, submittedBy: "author", actions: ["return" as const] };
    const { rerender } = render(<RoomPassportCard initialPassport={submitted} viewerId="author" />);
    expect(screen.getByRole("status").textContent).toContain(translate(language, "passport.submittedThanks"));
    expect(screen.getByRole("status").textContent).toContain(translate(language, "passport.waitingResult"));
    rerender(<RoomPassportCard initialPassport={submitted} viewerId="colleague" />);
    expect(screen.getByRole("status").textContent).toContain(translate(language, "passport.waitingSenderResult"));
    rerender(<RoomPassportCard key="reviewer" initialPassport={{ ...submitted, actions: ["return", "approve", "reject"] }} viewerId="reviewer" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(translate(language, "passport.reviewHint"))).toBeTruthy();
  });
  it("blocks stale mutations and offers an explicit card refresh", async () => {
    const fresh = { ...passport, status: "in_progress" as const, version: 2, actions: ["upload" as const] };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "passport_conflict" }, { status: 409 })).mockResolvedValueOnce(Response.json({ passport: fresh }));
    vi.stubGlobal("fetch", fetch);
    render(<RoomPassportCard initialPassport={passport} />);
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("другим пользователем"));
    expect((screen.getByRole("button", { name: "Начать" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Обновить данные" }));
    await waitFor(() => expect(screen.getByLabelText("Загрузить / заменить PDF")).toBeTruthy());
    expect(fetch.mock.calls[1][1].method).toBe("GET");
  });
  for (const language of ["ru", "kk", "en"] as const) it(`requires a reason and explicit confirmation before returning a passport in ${language}`, async () => {
    state.language = language;
    const current: RoomPassportDto = { ...passport, status: "approved", version: 4, file: { id: "file", name: "approved.pdf", size: 100, url: "/file?id=file" }, actions: ["return", "delete"] };
    const returned: RoomPassportDto = { ...current, status: "in_progress", version: 5, rejectionReason: "other", rejectionComment: "Sent by mistake", actions: ["upload", "submit", "delete"] };
    const fetch = vi.fn().mockResolvedValue(Response.json({ passport: returned }));
    vi.stubGlobal("fetch", fetch);
    render(<RoomPassportCard initialPassport={current} />);
    expect(screen.queryByRole("button", { name: translate(language, "passport.action.delete") })).toBeNull();
    const open = screen.getByRole("button", { name: translate(language, "passport.action.return") });
    fireEvent.click(open);
    expect(fetch).not.toHaveBeenCalled();
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(translate(language, "passport.returnApprovedHint"))).toBeTruthy();
    const reason = screen.getByLabelText(translate(language, "passport.returnReason"));
    expect(document.activeElement).toBe(reason);
    const confirm = screen.getByRole("button", { name: translate(language, "passport.confirmReturn") }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "other" } });
    const comment = screen.getByLabelText(translate(language, "passport.comment"));
    fireEvent.change(comment, { target: { value: "  " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: translate(language, "passport.cancel") }));
    expect(document.activeElement).toBe(open);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(open);
    expect((screen.getByLabelText(translate(language, "passport.returnReason")) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(translate(language, "passport.returnReason")), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText(translate(language, "passport.comment")), { target: { value: "Sent by mistake" } });
    fireEvent.click(screen.getByRole("button", { name: translate(language, "passport.confirmReturn") }));
    await waitFor(() => expect(screen.getByText(`2. ${translate(language, "passport.status.in_progress")}`)).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: "return", version: 4, reason: "other", comment: "Sent by mistake" });
    expect(screen.getByText("Sent by mistake")).toBeTruthy();
    expect(screen.getByRole("link", { name: translate(language, "passport.view") }).getAttribute("href")).toBe(current.file!.url);
    expect(screen.queryByRole("form", { name: translate(language, "passport.returnTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: translate(language, "passport.action.delete") })).toBeNull();
  });
  it("isolates withdrawal from a reviewer's rejection and approval controls", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<RoomPassportCard initialPassport={{ ...passport, status: "in_review", actions: ["return", "approve", "reject"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Вернуть в работу" }));
    expect(screen.getByText(translate("ru", "passport.returnReviewHint"))).toBeTruthy();
    expect(screen.queryByLabelText("Причина отклонения")).toBeNull();
    expect((screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByLabelText("Причина отклонения")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Принять" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("keeps a published PDF visible in a limited room workspace", () => {
    render(<RoomWorkspaceView room={{ access: "limited", id: "room1", designation: "101", responsibleName: null, items: [], passport: { id: "file", name: "room.pdf", size: 100, url: "/api/room-passports/room1/published?fileId=file" } }} authenticated returnTo="/rooms/room1" />);
    expect(screen.getByRole("link", { name: "Просмотреть PDF" }).getAttribute("href")).toContain("/published?");
    expect(screen.getByRole("link", { name: "Скачать PDF" }).getAttribute("href")).toContain("download=1");
  });
});
