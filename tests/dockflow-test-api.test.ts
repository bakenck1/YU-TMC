import assert from "node:assert/strict";
import test from "node:test";

import { GET as openApi } from "../app/api/openapi.json/route";
import {
  type DockflowDataRepository,
  createPostgresDockflowRepository,
  dockflowAuthCheck,
  findDockflowEmployee,
  findDockflowEmployeeItems,
  findDockflowItemPhoto,
  listDockflowEmployees,
  listDockflowItems,
} from "../lib/dockflow-api";
import { YessenovDirectoryError } from "../lib/yessenov-directory";

const API_KEY = "dockflow-key-for-automated-tests";
function request(path: string, key = API_KEY) {
  return new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${key}` } });
}

const employee = {
  id: 10001,
  personnelId: 20001,
  iin: "000000000000",
  username: "employee",
  firstName: "Сотрудник",
  lastName: "Интеграции",
  middleName: null,
  fullName: "Сотрудник интеграции",
  displayName: "Сотрудник интеграции",
  email: "employee@example.test",
  phone: "+77000000000",
  image: null,
  isActive: true,
  isSuperuser: false,
  roles: ["personnel"],
  employedAt: "2025-07-24",
  orgUnit: { id: 24, nameRu: "ИТ", nameKk: null, nameEn: "IT" },
  position: { id: 379, name: "Специалист" },
  login: "employee",
  role: "personnel",
};

const repository: DockflowDataRepository = {
  async listEmployees() { return [{ ...employee, itemCount: 1 }]; },
  async findEmployee(iin) { return iin === employee.iin ? employee : null; },
  async itemsForEmployee() { return [{ id: "00000000-0000-4000-8000-000000000001", name: "Стул офисный", barcode: "YU-000001", inventoryNumber: "INV-2026-001", quantity: 38, status: "assigned" as const, storageLocation: "Корпус A, кабинет 205", assignedAt: "2026-08-28T10:00:00.000Z", cost: 45000, markingType: "batch" as const, photoUrl: null, itemType: "furniture", brand: null, model: null, inventoryStatus: "active", responsible: { iin: "000000000000", fullName: "Устаревшее локальное имя" }, updatedAt: "2026-08-28T10:00:00.000Z", issueHistory: [] }]; },
  async listItems() { return [{ id: "00000000-0000-4000-8000-000000000001", name: "Стул офисный", barcode: "YU-000001", inventoryNumber: "INV-2026-001", quantity: 38, availableQuantity: 0, status: "assigned" as const, storageLocation: "Корпус A, кабинет 205", cost: 45000, markingType: "batch" as const, photoUrl: null, itemType: "furniture", brand: null, model: null, inventoryStatus: "active", responsible: { iin: "000000000000", fullName: "Сотрудник интеграции" }, updatedAt: "2026-08-28T10:00:00.000Z", assignments: [{ employeeIin: "000000000000", quantity: 38, assignedAt: "2026-08-28T10:00:00.000Z" }], issueHistory: [] }]; },
  async findItemPhoto() { return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" as const }; },
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
  assert.equal(body.employee.login, "employee");
  assert.equal(body.employee.orgUnit.nameEn, "IT");
  assert.equal(body.items[0].quantity, 38);
  assert.equal(body.items[0].responsible.fullName, employee.fullName);
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

test("serves item photos through the Dockflow application facade", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const response = await findDockflowItemPhoto(request(`/api/v1/items/${id}/photo`), id, repository);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await findDockflowItemPhoto(request("/api/v1/items/invalid/photo"), "invalid", repository)).status, 404);
});

test("joins Yessenov directory profiles to local item counts by IIN", async () => {
  const joined = createPostgresDockflowRepository(
    {
      async listEmployees() { return [employee]; },
      async findEmployee(iin) { return iin === employee.iin ? employee : null; },
    },
    {
      async itemCountsByIin() { return new Map([[employee.iin, 7]]); },
      async itemsForEmployee() { return []; },
      async listItems() { return []; },
      async findItemPhoto() { return null; },
    },
  );

  assert.deepEqual(await joined.listEmployees(), [{ ...employee, itemCount: 7 }]);
  assert.equal((await joined.findEmployee(employee.iin))?.login, employee.username);
});

test("returns a controlled response when the Yessenov directory is unavailable", async () => {
  const unavailable: DockflowDataRepository = {
    ...repository,
    async findEmployee() {
      throw new YessenovDirectoryError("unavailable", "upstream failed");
    },
  };
  const response = await findDockflowEmployee(
    request(`/api/v1/employees/${employee.iin}`),
    employee.iin,
    unavailable,
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "YESSENOV_DIRECTORY_UNAVAILABLE");
});

test("publishes an OpenAPI contract for bearer authorization", async () => {
  const document = await openApi().json();
  assert.equal(document.info.title, "Dockflow API");
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, "bearer");
});
