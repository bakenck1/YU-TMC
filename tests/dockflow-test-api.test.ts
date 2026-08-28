import assert from "node:assert/strict";
import test from "node:test";

import { GET as checkKey } from "../app/api/v1/auth/check/route";
import { GET as employeeByIin } from "../app/api/v1/employees/[iin]/route";
import { GET as employeeItems } from "../app/api/v1/employees/[iin]/items/route";
import { GET as employeeList } from "../app/api/v1/employees/route";
import { GET as itemList } from "../app/api/v1/items/route";
import { GET as openApi } from "../app/api/openapi.json/route";

const TEST_KEY = "dockflow-test-key-for-automated-tests";

function request(path: string, key = TEST_KEY) {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
}

test.beforeEach(() => {
  process.env.DOCKFLOW_TEST_API_KEY = TEST_KEY;
});

test.after(() => {
  delete process.env.DOCKFLOW_TEST_API_KEY;
});

test("checks the configured Bearer API key without caching the response", async () => {
  const valid = checkKey(request("/api/v1/auth/check"));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { valid: true });
  assert.match(valid.headers.get("cache-control") ?? "", /no-store/);

  const missing = checkKey(new Request("http://localhost/api/v1/auth/check"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(await missing.json(), {
    error: "UNAUTHORIZED",
    message: "Отсутствует или неверно указан API-ключ.",
  });

  const invalid = checkKey(request("/api/v1/auth/check", "wrong-key"));
  assert.equal(invalid.status, 401);
});

test("fails closed when the shared test key is not configured", async () => {
  delete process.env.DOCKFLOW_TEST_API_KEY;
  const response = checkKey(request("/api/v1/auth/check"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "API_NOT_CONFIGURED",
    message: "Тестовый API Dockflow не настроен.",
  });
});

test("returns the fake employee and only that employee's arbitrary batch share", async () => {
  const response = await employeeByIin(
    request("/api/v1/employees/990101123456"),
    { params: Promise.resolve({ iin: "990101123456" }) },
  );
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.employee, {
    iin: "990101123456",
    fullName: "Тестовый сотрудник",
    phone: "+77001234567",
    login: "dockflow.test",
  });
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].barcode, "DF-000001");
  assert.equal(body.items[0].quantity, 38);
  assert.equal(body.items[0].markingType, "batch");
});

test("returns a stable 404 error and validates the IIN format", async () => {
  const notFound = await employeeByIin(
    request("/api/v1/employees/111111111111"),
    { params: Promise.resolve({ iin: "111111111111" }) },
  );
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), {
    error: "EMPLOYEE_NOT_FOUND",
    message: "Пользователь с указанным ИИН не найден.",
  });

  const invalid = await employeeByIin(
    request("/api/v1/employees/not-an-iin"),
    { params: Promise.resolve({ iin: "not-an-iin" }) },
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "INVALID_IIN");
});

test("serves employee-only items and protected collection endpoints", async () => {
  const assigned = await employeeItems(
    request("/api/v1/employees/990101654321/items"),
    { params: Promise.resolve({ iin: "990101654321" }) },
  );
  const assignedBody = await assigned.json();
  assert.equal(assignedBody.items[0].quantity, 4);

  const employees = employeeList(request("/api/v1/employees"));
  assert.equal((await employees.json()).employees.length, 2);

  const items = itemList(request("/api/v1/items"));
  const itemsBody = await items.json();
  assert.equal(itemsBody.items.length, 2);
  assert.equal(itemsBody.items[0].quantity, 50);
  assert.equal(itemsBody.items[0].availableQuantity, 8);
  const assignedQuantity = itemsBody.items[0].assignments.reduce(
    (total: number, entry: { quantity: number }) => total + entry.quantity,
    0,
  );
  assert.equal(
    assignedQuantity + itemsBody.items[0].availableQuantity,
    itemsBody.items[0].quantity,
  );
  assert.equal(itemsBody.items[1].markingType, "package_or_storage");
});

test("publishes an OpenAPI contract for every test route and bearer authorization", async () => {
  const response = openApi();
  assert.equal(response.status, 200);
  const document = await response.json();

  assert.equal(document.info.title, "Dockflow API");
  assert.deepEqual(
    document.tags.map((tag: { name: string }) => tag.name),
    ["Authentication", "Employees", "Inventory"],
  );
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(Object.keys(document.paths).sort(), [
    "/api/v1/auth/check",
    "/api/v1/employees",
    "/api/v1/employees/{iin}",
    "/api/v1/employees/{iin}/items",
    "/api/v1/items",
  ]);
});
