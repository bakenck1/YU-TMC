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
import { externalJson } from "../lib/server/http/external-api";

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
test.afterEach(() => { delete process.env.DOCKFLOW_API_KEY_NEXT; });
test.after(() => { delete process.env.DOCKFLOW_API_KEY; });

test("checks the Bearer API key without caching the response", async () => {
  const valid = dockflowAuthCheck(request("/api/v1/auth/check"));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { valid: true });
  assert.match(valid.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(dockflowAuthCheck(new Request("http://localhost/api/v1/auth/check")).status, 401);
  assert.equal((await listDockflowItems(new Request("http://localhost/api/v1/items"))).status, 401);
});

test("external responses normalize request IDs and allowlist Retry-After", () => {
  const unsafe = externalJson({}, 503, { "X-Request-Id": "request-1", "Retry-After": "secret" });
  assert.equal(unsafe.headers.get("x-request-id"), "request-1");
  assert.equal(unsafe.headers.get("retry-after"), null);
  assert.equal(externalJson({}, 503, { "Retry-After": "5" }).headers.get("retry-after"), "5");
});

test("accepts current and next keys during rotation and rejects both after cutover", () => {
  process.env.DOCKFLOW_API_KEY_NEXT = "dockflow-next-key";
  assert.equal(dockflowAuthCheck(request("/api/v1/auth/check", API_KEY)).status, 200);
  assert.equal(dockflowAuthCheck(request("/api/v1/auth/check", "dockflow-next-key")).status, 200);
  process.env.DOCKFLOW_API_KEY = "dockflow-next-key";
  delete process.env.DOCKFLOW_API_KEY_NEXT;
  assert.equal(dockflowAuthCheck(request("/api/v1/auth/check", API_KEY)).status, 401);
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

test("collection pagination is bounded, deterministic at the repository seam, and explicit", async () => {
  const seen: unknown[] = [];
  const paged = { ...repository, async listItems(page?: unknown) { seen.push(page); return [...await repository.listItems(), ...await repository.listItems()]; } };
  const first = await listDockflowItems(request("/api/v1/items?limit=1"), paged);
  const firstBody = await first.json();
  assert.equal(firstBody.items.length, 1); assert.equal(typeof firstBody.nextCursor, "string");
  assert.deepEqual(seen[0], { after: null, limit: 2 });
  const second = await listDockflowItems(request(`/api/v1/items?limit=1&cursor=${firstBody.nextCursor}`), paged);
  assert.equal(second.status, 200);
  assert.deepEqual(seen[1], {
    after: { sortValue: "2026-08-28T10:00:00.000Z", id: "00000000-0000-4000-8000-000000000001" },
    limit: 2,
  });
  assert.equal((await listDockflowItems(request("/api/v1/items?limit=201"), paged)).status, 400);
  assert.equal((await listDockflowItems(request("/api/v1/items?unknown=1"), paged)).status, 400);
});

test("rejects cursor timestamps that normalize to a different calendar date", async () => {
  const invalidCursor = Buffer.from(JSON.stringify([
    1,
    "items",
    null,
    "2026-02-30T00:00:00.000Z",
    "00000000-0000-4000-8000-000000000001",
  ])).toString("base64url");
  const response = await listDockflowItems(request(`/api/v1/items?cursor=${invalidCursor}`), repository);

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_PAGE");
});

test("employee item envelopes are bounded and expose continuation", async () => {
  const seen: unknown[] = [];
  const paged = {
    ...repository,
    async itemsForEmployee(_iin: string, page?: unknown) {
      seen.push(page);
      return [...await repository.itemsForEmployee(employee.iin), ...await repository.itemsForEmployee(employee.iin)];
    },
  };
  const detail = await findDockflowEmployee(request(`/api/v1/employees/${employee.iin}?limit=1`), employee.iin, paged);
  const body = await detail.json();
  assert.equal(body.items.length, 1);
  assert.equal(typeof body.nextCursor, "string");
  assert.deepEqual(seen[0], { after: null, limit: 2 });
  const items = await findDockflowEmployeeItems(request(`/api/v1/employees/${employee.iin}/items?limit=1&cursor=${body.nextCursor}`), employee.iin, paged);
  assert.equal(items.status, 200);
  assert.deepEqual(seen[1], {
    after: { sortValue: "2026-08-28T10:00:00.000Z", id: "00000000-0000-4000-8000-000000000001" },
    limit: 2,
  });
});

test("item continuation remains stable when a newer row appears between pages", async () => {
  const template = (await repository.listItems())[0];
  assert.ok(template);
  let rows = [
    { ...template, id: "00000000-0000-4000-8000-000000000001", updatedAt: "2026-08-28T10:00:00.000Z" },
    { ...template, id: "00000000-0000-4000-8000-000000000002", updatedAt: "2026-08-27T10:00:00.000Z" },
    { ...template, id: "00000000-0000-4000-8000-000000000003", updatedAt: "2026-08-26T10:00:00.000Z" },
  ];
  const changing = {
    ...repository,
    async listItems(page = { after: null, limit: 101 }) {
      return rows
        .filter((item) => !page.after
          || item.updatedAt < page.after.sortValue
          || (item.updatedAt === page.after.sortValue && item.id > page.after.id))
        .slice(0, page.limit);
    },
  } satisfies DockflowDataRepository;

  const first = await listDockflowItems(request("/api/v1/items?limit=1"), changing);
  const firstBody = await first.json();
  rows = [
    { ...template, id: "00000000-0000-4000-8000-000000000004", updatedAt: "2026-08-29T10:00:00.000Z" },
    ...rows,
  ];
  const second = await listDockflowItems(request(`/api/v1/items?limit=1&cursor=${firstBody.nextCursor}`), changing);
  const secondBody = await second.json();

  assert.equal(firstBody.items[0].id, "00000000-0000-4000-8000-000000000001");
  assert.equal(secondBody.items[0].id, "00000000-0000-4000-8000-000000000002");
});

test("unexpected inventory and photo failures use stable retryable JSON without details", async () => {
  const broken = { ...repository, async listItems() { throw new Error("password=secret"); }, async findItemPhoto() { throw new Error("binary detail"); } };
  const list = await listDockflowItems(request("/api/v1/items"), broken);
  assert.equal(list.status, 503); assert.deepEqual(await list.json(), { error: "DEPENDENCY_UNAVAILABLE", message: "Dockflow dependency is unavailable." });
  assert.equal(list.headers.get("retry-after"), "5"); assert.ok(list.headers.get("x-request-id"));
  const photoResponse = await findDockflowItemPhoto(request(`/api/v1/items/00000000-0000-4000-8000-000000000001/photo`), "00000000-0000-4000-8000-000000000001", broken);
  assert.equal(photoResponse.status, 503); assert.doesNotMatch(await photoResponse.text(), /binary detail/);
});

test("serves item photos through the Dockflow application facade", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const response = await findDockflowItemPhoto(request(`/api/v1/items/${id}/photo`), id, repository);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("accept-ranges"), "none");
  assert.ok(response.headers.get("x-request-id"));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await findDockflowItemPhoto(request("/api/v1/items/invalid/photo"), "invalid", repository)).status, 404);
  const ranged = await findDockflowItemPhoto(new Request(`http://localhost/api/v1/items/${id}/photo`, { headers: { Authorization: `Bearer ${API_KEY}`, Range: "bytes=0-1" } }), id, repository);
  assert.equal(ranged.status, 416);
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
  for (const path of ["/api/v1/employees", "/api/v1/employees/{iin}", "/api/v1/employees/{iin}/items", "/api/v1/items"]) {
    const names = document.paths[path].get.parameters.map((entry: { $ref: string }) => entry.$ref);
    assert.ok(names.includes("#/components/parameters/Limit"));
    assert.ok(names.includes("#/components/parameters/Cursor"));
  }
  assert.ok(document.paths["/api/v1/items/{id}/photo"].get.responses["416"]);
  for (const path of Object.values(document.paths) as Array<{ get?: { responses?: Record<string, { content?: Record<string, { schema?: unknown; example?: unknown }> }> } }>) {
    for (const response of Object.values(path.get?.responses ?? {})) {
      for (const media of Object.values(response.content ?? {})) {
        if (media.example !== undefined && media.schema) assertSchemaExample(document, media.schema, media.example);
      }
    }
  }
});

interface ExampleSchema {
  $ref?: string;
  allOf?: ExampleSchema[];
  type?: string | string[];
  required?: string[];
  properties?: Record<string, ExampleSchema>;
  items?: ExampleSchema;
}

function assertSchemaExample(
  document: { components: { schemas: Record<string, ExampleSchema> } },
  schema: ExampleSchema,
  value: unknown,
): void {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    assert.ok(name && document.components.schemas[name], `Unknown OpenAPI schema ${schema.$ref}`);
    const resolved = document.components.schemas[name];
    assertSchemaExample(document, resolved, value);
    return;
  }
  for (const part of schema.allOf ?? []) assertSchemaExample(document, part, value);
  if (schema.type === "object" || schema.properties) {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) assert.ok(Object.prototype.hasOwnProperty.call(record, key), `OpenAPI example misses required ${key}`);
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(record, key)) assertSchemaExample(document, property, record[key]);
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) for (const item of value) assertSchemaExample(document, schema.items, item);
}
