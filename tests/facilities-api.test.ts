import assert from "node:assert/strict";
import test from "node:test";

import { dockflowAuthCheck } from "../lib/dockflow-api";
import {
  facilitiesAuthCheck,
  type FacilitiesRepository,
  listFacilitiesBuildings,
  listFacilitiesRooms,
} from "../lib/facilities-api";

const FACILITIES_KEY = "facilities-key-for-automated-tests";
const DOCKFLOW_KEY = "dockflow-key-for-automated-tests";
const buildingId = "00000000-0000-4000-8000-000000000010";

function request(path: string, key = FACILITIES_KEY) {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
}

const repository: FacilitiesRepository = {
  async listBuildings() {
    return [{
      id: buildingId,
      name: "Корпус A",
      address: "г. Актау",
      roomCount: 1,
      updatedAt: "2026-09-22T08:00:00.000Z",
    }];
  },
  async listRooms(requestedBuildingId) {
    assert.equal(requestedBuildingId, buildingId);
    return [{
      id: "00000000-0000-4000-8000-000000000011",
      buildingId,
      buildingName: "Корпус A",
      designation: "205",
      floorNumber: 2,
      floorLabel: null,
      updatedAt: "2026-09-22T08:00:00.000Z",
    }];
  },
};

test.beforeEach(() => {
  process.env.FACILITIES_API_KEY = FACILITIES_KEY;
  process.env.DOCKFLOW_API_KEY = DOCKFLOW_KEY;
});

test.afterEach(() => {
  delete process.env.FACILITIES_API_KEY_NEXT;
  delete process.env.DOCKFLOW_API_KEY_NEXT;
});

test.after(() => {
  delete process.env.FACILITIES_API_KEY;
  delete process.env.DOCKFLOW_API_KEY;
});

test("keeps the facilities key isolated from employee and inventory access", async () => {
  assert.equal(facilitiesAuthCheck(request("/api/v1/facilities/auth/check")).status, 200);
  assert.deepEqual(
    await facilitiesAuthCheck(request("/api/v1/facilities/auth/check")).json(),
    { valid: true, scope: "facilities:read" },
  );
  assert.equal(dockflowAuthCheck(request("/api/v1/auth/check")).status, 401);
  assert.equal(
    facilitiesAuthCheck(request("/api/v1/facilities/auth/check", DOCKFLOW_KEY)).status,
    401,
  );
});

test("supports independent facilities key rotation", () => {
  process.env.FACILITIES_API_KEY_NEXT = "next-facilities-key";
  assert.equal(
    facilitiesAuthCheck(request("/api/v1/facilities/auth/check", "next-facilities-key")).status,
    200,
  );
  process.env.FACILITIES_API_KEY = "next-facilities-key";
  delete process.env.FACILITIES_API_KEY_NEXT;
  assert.equal(facilitiesAuthCheck(request("/api/v1/facilities/auth/check")).status, 401);
});

test("returns only the minimal building and room projections", async () => {
  const buildingsResponse = await listFacilitiesBuildings(
    request("/api/v1/buildings"),
    repository,
  );
  assert.equal(buildingsResponse.status, 200);
  const building = (await buildingsResponse.json()).buildings[0];
  assert.deepEqual(Object.keys(building).sort(), [
    "address", "id", "name", "roomCount", "updatedAt",
  ]);

  const roomsResponse = await listFacilitiesRooms(
    request(`/api/v1/rooms?buildingId=${buildingId}`),
    repository,
  );
  assert.equal(roomsResponse.status, 200);
  const room = (await roomsResponse.json()).rooms[0];
  assert.deepEqual(Object.keys(room).sort(), [
    "buildingId", "buildingName", "designation", "floorLabel", "floorNumber", "id", "updatedAt",
  ]);
  assert.equal("primaryResponsible" in room, false);
  assert.equal("accessMode" in room, false);
  assert.equal("qrCode" in room, false);
});

test("rejects unknown parameters and invalid building identifiers", async () => {
  assert.equal(
    (await listFacilitiesBuildings(request("/api/v1/buildings?all=true"), repository)).status,
    400,
  );
  assert.equal(
    (await listFacilitiesRooms(request("/api/v1/rooms?buildingId=not-a-uuid"), repository)).status,
    400,
  );
  assert.equal(
    (await listFacilitiesRooms(request("/api/v1/rooms?unknown=1"), repository)).status,
    400,
  );
});

test("fails closed when the facilities key is not configured", async () => {
  delete process.env.FACILITIES_API_KEY;
  assert.equal(facilitiesAuthCheck(request("/api/v1/facilities/auth/check")).status, 503);
  assert.equal(
    (await listFacilitiesBuildings(request("/api/v1/buildings"), repository)).status,
    503,
  );
});

test("returns a controlled retryable error without database details", async () => {
  const broken: FacilitiesRepository = {
    async listBuildings() { throw new Error("password=secret"); },
    async listRooms() { throw new Error("private row"); },
  };
  const response = await listFacilitiesBuildings(request("/api/v1/buildings"), broken);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.doesNotMatch(await response.text(), /password|secret/i);
});
