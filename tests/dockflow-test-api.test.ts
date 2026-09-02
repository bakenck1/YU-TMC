import assert from "node:assert/strict";
import test from "node:test";

import { GET as openApi } from "../app/api/openapi.json/route";
import {
  type DockflowDataRepository,
  dockflowAuthCheck,
  findDockflowEmployee,
  findDockflowEmployeeItems,
  listDockflowEmployees,
  listDockflowItems,
} from "../lib/dockflow-api";

const API_KEY = "dockflow-key-for-automated-tests";
function request(path: string, key = API_KEY) {
  return new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${key}` } });
}

const repository: DockflowDataRepository = {
  async listEmployees() { return [{ iin: "000000000000", fullName: "Сотрудник интеграции", phone: "+77000000000", login: "employee@example.test", email: "employee@example.test", role: "employee", createdAt: "2026-01-01T00:00:00.000Z", itemCount: 1 }]; },
  async findEmployee(iin) { return iin === "000000000000" ? { iin, fullName: "Сотрудник интеграции", phone: "+77000000000", login: "employee@example.test", email: "employee@example.test", role: "employee", createdAt: "2026-01-01T00:00:00.000Z" } : null; },
  async itemsForEmployee() { return [{ id: "00000000-0000-4000-8000-000000000001", name: "Стул офисный", barcode: "YU-000001", inventoryNumber: "INV-2026-001", quantity: 38, status: "assigned" as const, storageLocation: "Корпус A, кабинет 205", assignedAt: "2026-08-28T10:00:00.000Z", cost: 45000, markingType: "batch" as const, photoUrl: null, itemType: "furniture", brand: null, model: null, inventoryStatus: "active", responsible: { iin: "000000000000", fullName: "Сотрудник интеграции" }, updatedAt: "2026-08-28T10:00:00.000Z", issueHistory: [] }]; },
  async listItems() { return [{ id: "00000000-0000-4000-8000-000000000001", name: "Стул офисный", barcode: "YU-000001", inventoryNumber: "INV-2026-001", quantity: 38, availableQuantity: 0, status: "assigned" as const, storageLocation: "Корпус A, кабинет 205", cost: 45000, markingType: "batch" as const, photoUrl: null, itemType: "furniture", brand: null, model: null, inventoryStatus: "active", responsible: { iin: "000000000000", fullName: "Сотрудник интеграции" }, updatedAt: "2026-08-28T10:00:00.000Z", assignments: [{ employeeIin: "000000000000", quantity: 38, assignedAt: "2026-08-28T10:00:00.000Z" }], issueHistory: [] }]; },
};

test.beforeEach(() => { process.env.DOCKFLOW_API_KEY = API_KEY; });
test.after(() => { delete process.env.DOCKFLOW_API_KEY; });

test("checks the Bearer API key without caching the response", async () => {
  const valid = dockflowAuthCheck(request("/api/v1/auth/check"));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { valid: true });
  assert.match(valid.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(dockflowAuthCheck(new Request("http://localhost/api/v1/auth/check")).status, 401);
});

test("returns registered employees and their current TMC by real IIN", async () => {
  const response = await findDockflowEmployee(request("/api/v1/employees/000000000000"), "000000000000", repository);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.employee.login, "employee@example.test");
  assert.equal(body.items[0].quantity, 38);
  assert.equal((await findDockflowEmployeeItems(request("/api/v1/employees/000000000000/items"), "000000000000", repository)).status, 200);
});

test("validates IIN and hides non-registered people", async () => {
  assert.equal((await findDockflowEmployee(request("/api/v1/employees/111111111111"), "111111111111", repository)).status, 404);
  assert.equal((await findDockflowEmployee(request("/api/v1/employees/not-an-iin"), "not-an-iin", repository)).status, 400);
});

test("protects real employee and inventory collections", async () => {
  assert.equal((await (await listDockflowEmployees(request("/api/v1/employees"), repository)).json()).employees[0].itemCount, 1);
  assert.equal((await (await listDockflowItems(request("/api/v1/items"), repository)).json()).items[0].assignments[0].employeeIin, "000000000000");
});

test("publishes an OpenAPI contract for bearer authorization", async () => {
  const document = await openApi().json();
  assert.equal(document.info.title, "Dockflow API");
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, "bearer");
});
