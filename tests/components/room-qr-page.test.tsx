import { beforeEach, describe, expect, it, vi } from "vitest";

import PublicRoomQrPage from "@/app/rooms/qr/[token]/page";
import { RoomWorkspaceService } from "@/lib/application/services/room-workspace-service";
import type { RoomWorkspaceRepositories, RoomWorkspaceRecord } from "@/lib/application/ports/room-workspace-repositories";
import { ApplicationError } from "@/lib/domain/application-error";

const state = vi.hoisted(() => ({
  sessionToken: "session" as string | undefined,
  resolveUser: vi.fn(),
  findRoomByQr: vi.fn(),
  listRoomItems: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => state.sessionToken ? { value: state.sessionToken } : undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); },
}));
vi.mock("@/lib/security/session", () => ({ SESSION_COOKIE_NAME: "session" }));
vi.mock("@/lib/server/security/request-user", () => ({
  resolveCurrentUserToken: state.resolveUser,
  authorizationActor: (user: unknown) => user,
}));
vi.mock("@/lib/server/application", () => ({
  getApplicationServices: () => ({ rooms: service }),
}));

const TOKEN = "YUQ1:29A5TSDMTBH1K774SJYDMGYY7X";
const ROOM: RoomWorkspaceRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  designation: "5 этаж склад",
  buildingName: "The Main Campus",
  floorNumber: 5,
  floorLabel: null,
  primaryResponsibleId: null,
  primaryResponsibleName: null,
  accessMode: "closed",
};
const repositories: RoomWorkspaceRepositories = {
  rooms: {
    findRoomById: async () => ROOM,
    findRoomByQr: state.findRoomByQr,
    listRoomItems: state.listRoomItems,
  },
};
const read = <Result,>(work: (repos: RoomWorkspaceRepositories) => Promise<Result>) => work(repositories);
const service = new RoomWorkspaceService({ read, transaction: read });
const openPage = (token: string) => PublicRoomQrPage({ params: Promise.resolve({ token }) });

beforeEach(() => {
  state.sessionToken = "session";
  state.resolveUser.mockReset().mockResolvedValue({ userId: "admin", role: "admin", sessionVersion: 1 });
  state.findRoomByQr.mockReset().mockResolvedValue(ROOM);
  state.listRoomItems.mockReset().mockResolvedValue([]);
});

describe("opening existing printed room QR links", () => {
  it("decodes the Next.js path parameter before the real QR validator and room lookup", async () => {
    const page = await openPage(encodeURIComponent(TOKEN));
    expect(state.findRoomByQr).toHaveBeenCalledWith(TOKEN);
    expect(page.props.room).toMatchObject({ access: "full", designation: ROOM.designation });
    expect(page.props.returnTo).toBe(`/rooms/qr/${encodeURIComponent(TOKEN)}`);
    expect(page.props.authenticated).toBe(true);
  });

  it("also accepts an unescaped identifier", async () => {
    await openPage(TOKEN);
    expect(state.findRoomByQr).toHaveBeenCalledWith(TOKEN);
  });

  it.each(["Кабинет 5/склад", "legacy%3Avalue", "legacy?value#1"])(
    "decodes legacy identifier %s exactly once without changing its stored value",
    async (token) => {
      const page = await openPage(encodeURIComponent(token));
      expect(state.findRoomByQr).toHaveBeenCalledWith(token);
      expect(page.props.returnTo).toBe(`/rooms/qr/${encodeURIComponent(token)}`);
    },
  );

  it("preserves the original QR destination for an unauthenticated visitor without exposing room data", async () => {
    state.sessionToken = undefined;
    const page = await openPage(encodeURIComponent(TOKEN));
    expect(page.props.room).toEqual({ access: "authentication_required" });
    expect(page.props.authenticated).toBe(false);
    expect(page.props.returnTo).toBe(`/rooms/qr/${encodeURIComponent(TOKEN)}`);
    expect(state.listRoomItems).not.toHaveBeenCalled();
  });

  it("keeps closed rooms inaccessible to other employees", async () => {
    state.resolveUser.mockResolvedValue({ userId: "outsider", role: "employee", sessionVersion: 1 });
    const page = await openPage(encodeURIComponent(TOKEN));
    expect(page.props.room).toEqual({ access: "denied", items: [] });
  });

  it("preserves read-only access for printing staff", async () => {
    state.resolveUser.mockResolvedValue({ userId: "printer", role: "typography", sessionVersion: 1 });
    const page = await openPage(encodeURIComponent(TOKEN));
    expect(page.props.readOnly).toBe(true);
  });

  it.each(["bad%", "%E0%A4%A", "YUQ1%3Ainvalid", "YUQ2%3A00000000000000000000000000", "YUQ1%3A%00"])(
    "returns not found for malformed input %s instead of crashing the page",
    async (token) => {
      await expect(openPage(token)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(state.findRoomByQr).not.toHaveBeenCalled();
    },
  );

  it("returns not found for an unknown or revoked room QR", async () => {
    state.findRoomByQr.mockResolvedValue(null);
    await expect(openPage(encodeURIComponent(TOKEN))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("does not disguise database failures as a missing room", async () => {
    const error = new ApplicationError("unavailable", "database_unavailable");
    state.findRoomByQr.mockRejectedValue(error);
    await expect(openPage(encodeURIComponent(TOKEN))).rejects.toBe(error);
  });
});
