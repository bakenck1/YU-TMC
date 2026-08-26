import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { RoomDto } from "../lib/contracts/inventory-locations";
import { createInventoryRoomPostHandler } from "../lib/server/http/inventory-room-handler";

const ROOT = new URL("../", import.meta.url);
const BUILDING_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "admin" as const,
  sessionVersion: 7,
};

test("room POST accepts null and omitted responsible employee", async () => {
  const calls: unknown[] = [];
  const handler = createInventoryRoomPostHandler({
    authenticate: async () => ACTOR,
    createRoom: async (buildingId, input, actor) => {
      calls.push({ buildingId, input, actor });
      return roomDto(buildingId);
    },
  });

  const withNull = await handler(
    jsonRequest({
      designation: "101",
      floorNumber: 1,
      floorLabel: null,
      primaryResponsibleId: null,
    }),
    BUILDING_ID,
  );
  const omitted = await handler(
    jsonRequest({ designation: "102", floorNumber: 1 }),
    BUILDING_ID,
  );

  assert.equal(withNull.status, 201);
  assert.equal(omitted.status, 201);
  assert.deepEqual(calls, [
    {
      buildingId: BUILDING_ID,
      input: {
        designation: "101",
        floorNumber: 1,
        floorLabel: null,
        primaryResponsibleId: null,
      },
      actor: ACTOR,
    },
    {
      buildingId: BUILDING_ID,
      input: {
        designation: "102",
        floorNumber: 1,
        floorLabel: undefined,
        primaryResponsibleId: undefined,
      },
      actor: ACTOR,
    },
  ]);
});

test("room POST rejects invalid responsible employee values before persistence", async () => {
  let calls = 0;
  const handler = createInventoryRoomPostHandler({
    authenticate: async () => ACTOR,
    createRoom: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });

  for (const primaryResponsibleId of ["", 123, true, {}, []]) {
    const response = await handler(
      jsonRequest({
        designation: "101",
        floorNumber: 1,
        primaryResponsibleId,
      }),
      BUILDING_ID,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls, 0);
});

test("the Next route delegates room POST to the tested handler", async () => {
  const [form, route] = await Promise.all([
    readFile(new URL("components/InventoryRoomFormModal.tsx", ROOT), "utf8"),
    readFile(
      new URL("app/api/inventory/buildings/[id]/rooms/route.ts", ROOT),
      "utf8",
    ),
  ]);

  assert.match(form, /primaryResponsibleId: responsibleId \|\| null/);
  assert.doesNotMatch(form, /!responsibleId/);
  assert.match(
    route,
    /createInventoryRoomPostHandler/,
  );
  assert.match(route, /return post\(request, \(await params\)\.id\)/);
});

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function roomDto(buildingId: string): RoomDto {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    buildingId,
    designation: "101",
    floorNumber: 1,
    floorLabel: null,
    primaryResponsible: null,
    qrCode: "room-qr",
    status: "active",
    version: 1,
    createdAt: "2026-08-26T07:00:00.000Z",
    updatedAt: "2026-08-26T07:00:00.000Z",
  };
}
