import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { getRoomBooking } from "../lib/server/room-booking";
import type { VisibleRoomWorkspaceDto } from "../lib/contracts/room-workspace";

const room: VisibleRoomWorkspaceDto = {
  access: "full", id: "11111111-1111-4111-8111-111111111111",
  designation: "201", responsibleName: null, items: [],
};
const origin = "https://booking.example";
const href = `${origin}/?room=tmc_${room.id}`;
const keys = ["ROOM_BOOKING_ENABLED", "ROOM_BOOKING_ORIGIN", "ROOM_BOOKING_SHARED_SECRET", "NODE_ENV"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  Object.assign(process.env, {
    ROOM_BOOKING_ENABLED: "true", ROOM_BOOKING_ORIGIN: origin,
    ROOM_BOOKING_SHARED_SECRET: "test-booking-key-with-more-than-32-characters", NODE_ENV: "production",
  });
});
afterEach(() => {
  mock.restoreAll();
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("prelaunch never contacts the unlaunched booking service", async () => {
  process.env.ROOM_BOOKING_ENABLED = "false";
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  assert.deepEqual(await getRoomBooking(room), { status: "hidden" });
  delete process.env.ROOM_BOOKING_ENABLED;
  assert.deepEqual(await getRoomBooking(room), { status: "hidden" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("anonymous, denied and invalid rooms never contact booking or expose a link", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  for (const value of [{ access: "authentication_required" } as const, { access: "denied", items: [] } as const, { ...room, id: "invalid" }]) {
    assert.deepEqual(await getRoomBooking(value), { status: "hidden" });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("enabled imported rooms use the authenticated adapter without caching or redirects", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requestUrl = String(url); requestInit = init;
    return Response.json({ enabled: true, bookingUrl: href });
  });
  assert.deepEqual(await getRoomBooking(room), { status: "available", href });
  assert.equal(requestUrl, `${origin}/api/inventory?roomId=${room.id}`);
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), `Bearer ${process.env.ROOM_BOOKING_SHARED_SECRET}`);
  assert.ok(requestInit?.signal instanceof AbortSignal);
});

test("unpublished rooms, upstream errors and malformed responses do not break Inventory", async () => {
  const responses = [
    () => Response.json({ enabled: false, bookingUrl: null }),
    () => Response.json({ enabled: true, bookingUrl: href }, { status: 403 }),
    () => Response.json({ error: "UNAVAILABLE" }, { status: 503 }),
    () => new Response("not json"),
    () => Response.json(null),
    () => Response.json({ enabled: "true", bookingUrl: href }),
    () => { throw new DOMException("Timed out", "TimeoutError"); },
  ];
  for (const response of responses) {
    const fetchMock = mock.method(globalThis, "fetch", async () => response());
    assert.deepEqual(await getRoomBooking(room), { status: "hidden" });
    fetchMock.mock.restore();
  }
});

test("booking responses cannot redirect to a different origin, room or script", async () => {
  for (const bookingUrl of [
    "https://other.example/?room=tmc_" + room.id,
    `${origin}/?room=tmc_another-room`, `${origin}/login`, `${href}&returnTo=https://other.example`,
    `https://user:pass@booking.example/?room=tmc_${room.id}`, `${href}#fragment`,
    "javascript:alert(1)", "/?room=tmc_" + room.id,
  ]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => Response.json({ enabled: true, bookingUrl }));
    assert.deepEqual(await getRoomBooking(room), { status: "hidden" }, bookingUrl);
    fetchMock.mock.restore();
  }
});

test("invalid or incomplete deployment configuration never sends credentials", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  for (const value of ["", "not a url", "javascript:alert(1)", "http://booking.example", "http://localhost:3001", `${origin}/path`, `${origin}/?x=1`, `${origin}/#fragment`, "https://user:pass@booking.example"]) {
    process.env.ROOM_BOOKING_ORIGIN = value;
    assert.deepEqual(await getRoomBooking(room), { status: "hidden" });
  }
  process.env.ROOM_BOOKING_ORIGIN = origin;
  process.env.ROOM_BOOKING_SHARED_SECRET = "replace-with-a-random-production-api-key";
  assert.deepEqual(await getRoomBooking(room), { status: "hidden" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("local HTTP booking testing is available only in development", async () => {
  Object.assign(process.env, { NODE_ENV: "development", ROOM_BOOKING_ORIGIN: "http://127.0.0.1:3001" });
  const localHref = `http://127.0.0.1:3001/?room=tmc_${room.id}`;
  mock.method(globalThis, "fetch", async () => Response.json({ enabled: true, bookingUrl: localHref }));
  assert.deepEqual(await getRoomBooking(room), { status: "available", href: localHref });
});
