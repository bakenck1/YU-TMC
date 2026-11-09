import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as users, POST as createUser } from "@/app/api/users/route";
import { GET as transfers } from "@/app/api/inventory/transfers/route";
import { POST as decide } from "@/app/api/inventory/transfers/[id]/decision/route";
import { POST as cancel } from "@/app/api/inventory/transfers/[id]/cancel/route";
import { POST as override } from "@/app/api/inventory/transfers/[id]/override/route";
import { POST as tmcDecision } from "@/app/api/inventory/transfer-requests/[id]/decision/route";
import { POST as createService, GET as services } from "@/app/api/service-requests/route";
import { PATCH as serviceStatus } from "@/app/api/service-requests/[id]/route";
import { POST as createLoss, GET as losses } from "@/app/api/inventory/loss-cases/route";
import { POST as receipt } from "@/app/api/inventory/loss-cases/[id]/receipt/route";
import { POST as review } from "@/app/api/inventory/loss-cases/[id]/review/route";
import { GET as photo } from "@/app/api/inventory/items/[id]/photo/route";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: () => undefined }));
const id = randomUUID();
const ctx = { params: Promise.resolve({ id }) };
const cases: Array<{ path: string; method: string; invoke: (r: Request) => Promise<Response> }> = [
  { path: "/api/users", method: "GET", invoke: users },
  { path: `/api/inventory/items/${id}/photo`, method: "GET", invoke: r => photo(r, ctx) },
  { path: "/api/users", method: "POST", invoke: createUser },
  { path: "/api/inventory/transfers", method: "GET", invoke: transfers },
  { path: `/api/inventory/transfers/${id}/decision`, method: "POST", invoke: r => decide(r, ctx) },
  { path: `/api/inventory/transfers/${id}/cancel`, method: "POST", invoke: r => cancel(r, ctx) },
  { path: `/api/inventory/transfers/${id}/override`, method: "POST", invoke: r => override(r, ctx) },
  { path: `/api/inventory/transfer-requests/${id}/decision`, method: "POST", invoke: r => tmcDecision(r, ctx) },
  { path: "/api/service-requests", method: "POST", invoke: createService },
  { path: "/api/service-requests", method: "GET", invoke: services },
  { path: `/api/service-requests/${id}`, method: "PATCH", invoke: r => serviceStatus(r, ctx) },
  { path: "/api/inventory/loss-cases", method: "POST", invoke: createLoss },
  { path: "/api/inventory/loss-cases", method: "GET", invoke: losses },
  { path: `/api/inventory/loss-cases/${id}/receipt`, method: "POST", invoke: r => receipt(r, ctx) },
  { path: `/api/inventory/loss-cases/${id}/review`, method: "POST", invoke: r => review(r, ctx) },
];
describe("production route authorization with persisted sessions", () => {
  let userId: string;
  beforeAll(async () => {
    resetApplicationServicesForTests(); await setupTmcTransferDatabase();
    const f = await seedFixture(1); userId = f.initiatorId;
    await database.query("update yu_inventory.users set role='admin',version=2 where id=$1", [userId]);
  });
  afterAll(async () => { resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); });
  it.each(cases)("$method $path rejects a revoked session before exposing objects or validating input", async ({ path, method, invoke }) => {
    const request = authenticatedRequest(path, { userId, role: "admin", sessionVersion: 1 }, { method, ...(method === "GET" ? {} : { body: {} }) });
    const response = await invoke(request);
    expect(response.status, await response.clone().text()).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBe("unauthorized");
    expect(JSON.stringify(payload)).not.toContain(userId);
  });
  it.each(cases.filter(c => c.method !== "GET"))("$method $path blocks cross-origin mutations with a current session", async ({ path, method, invoke }) => {
    const request = authenticatedRequest(path, { userId, role: "admin", sessionVersion: 2 }, { method, body: {} });
    request.headers.set("origin", "https://foreign.invalid");
    const response = await invoke(request);
    expect(response.status, await response.clone().text()).toBe(403);
    expect((await response.json()).error).toBe("cross_site_request_blocked");
  });
});
