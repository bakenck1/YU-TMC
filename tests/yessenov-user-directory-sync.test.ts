import assert from "node:assert/strict";
import test from "node:test";

import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";
import type { YessenovDirectoryEmployee } from "../lib/yessenov-directory";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const GENERATED_IDS = [
  ADMIN_ID,
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

test("management list imports and refreshes all Yessenov personnel safely", async () => {
  const unitOfWork = new MemoryUserUnitOfWork();
  let directoryEmployees = [
    directoryEmployee({
      id: 1,
      personnelId: 10,
      iin: "000000000001",
      email: "admin@yu.edu.kz",
      fullName: "Администратор из Yessenov",
      roles: ["admin"],
    }),
    directoryEmployee({
      id: 2,
      personnelId: 20,
      iin: "000000000002",
      email: "employee@yu.edu.kz",
      fullName: "Новый сотрудник",
      roles: ["admin", "personnel"],
    }),
  ];
  const ids = [...GENERATED_IDS];
  const service = new UserService(
    unitOfWork,
    {
      async hash() {
        return { salt: "test", hash: new Uint8Array([1]) };
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-09-03T12:00:00.000Z") },
    { create: () => ids.shift()! },
    { async listEmployees() { return directoryEmployees; } },
  );
  await service.registerFirstAdmin({
    email: "admin@yu.edu.kz",
    name: "Локальный администратор",
    password: "Test-Password-2026!",
  });
  const actor = (await service.resolveCurrentAccount("admin@yu.edu.kz"))!;

  const first = await service.listUsersForManagement(actor);
  const synchronizedAdmin = first.find((user) => user.email === "admin@yu.edu.kz")!;
  const synchronizedEmployee = first.find((user) => user.email === "employee@yu.edu.kz")!;

  assert.equal(first.length, 2);
  assert.equal(synchronizedAdmin.fullName, "Администратор из Yessenov");
  assert.equal(synchronizedAdmin.role, "admin");
  assert.deepEqual(synchronizedAdmin.directoryRoles, ["admin"]);
  assert.equal(synchronizedEmployee.role, "employee");
  assert.deepEqual(synchronizedEmployee.directoryRoles, ["admin", "personnel"]);
  assert.equal(synchronizedEmployee.position, "Специалист");
  assert.equal(synchronizedEmployee.phone, "77000000000");
  assert.equal(synchronizedEmployee.directoryManaged, true);

  directoryEmployees = directoryEmployees.map((employee) =>
    employee.email === "employee@yu.edu.kz"
      ? {
          ...employee,
          fullName: "Обновлённый сотрудник",
          phone: "77111111111",
          position: { id: 99, name: "Руководитель" },
        }
      : employee,
  );
  const refreshed = await service.listUsersForManagement(actor);
  const refreshedEmployee = refreshed.find(
    (user) => user.email === "employee@yu.edu.kz",
  )!;

  assert.equal(refreshed.length, 2);
  assert.equal(refreshedEmployee.fullName, "Обновлённый сотрудник");
  assert.equal(refreshedEmployee.phone, "77111111111");
  assert.equal(refreshedEmployee.position, "Руководитель");
  assert.equal(refreshedEmployee.role, "employee");
  assert.equal((await service.listUsers()).length, 2);
  assert.equal(
    (await service.listUsers()).find((user) => user.email === "employee@yu.edu.kz")
      ?.fullName,
    "Обновлённый сотрудник",
  );
});

function directoryEmployee(
  overrides: Partial<YessenovDirectoryEmployee>,
): YessenovDirectoryEmployee {
  return {
    id: 100,
    personnelId: 200,
    iin: "000000000000",
    username: "test.employee",
    firstName: "Тест",
    lastName: "Сотрудников",
    middleName: null,
    fullName: "Сотрудников Тест",
    displayName: "Сотрудников Тест",
    email: "test.employee@yu.edu.kz",
    phone: "77000000000",
    image: null,
    isActive: true,
    isSuperuser: false,
    roles: ["personnel"],
    employedAt: "2025-07-24",
    orgUnit: {
      id: 24,
      nameRu: "Управление информационных технологий",
      nameKk: null,
      nameEn: "Department of Information Technologies",
    },
    position: { id: 379, name: "Специалист" },
    ...overrides,
  };
}
