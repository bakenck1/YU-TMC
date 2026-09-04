import assert from "node:assert/strict";
import test from "node:test";

import {
  createYessenovDirectoryClient,
  YessenovDirectoryError,
} from "../lib/yessenov-directory";

const TOKEN = "directory-service-token";

test("maps active personnel from the paginated Yessenov users API", async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    if (url.searchParams.get("page") === "2") {
      return Response.json({
        count: 2,
        size: 1,
        next: null,
        previous: "https://id.yu.edu.kz/api/users/",
        results: [directoryUser()],
      });
    }
    return Response.json({
      count: 2,
      size: 1,
      next: "https://id.yu.edu.kz/api/users/?page=2",
      previous: null,
      results: [directoryUser({ id: 12, is_active: false })],
    });
  }) as typeof fetch;

  const client = createYessenovDirectoryClient(fetcher, {
    YESSENOV_DIRECTORY_API_TOKEN: TOKEN,
  });
  const employees = await client.listEmployees();

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url.href, "https://id.yu.edu.kz/api/users/");
  assert.equal(requests[0]?.authorization, `Bearer ${TOKEN}`);
  assert.equal(employees.length, 1);
  assert.deepEqual(employees[0], {
    id: 10001,
    personnelId: 20001,
    iin: "000000000000",
    username: "test.employee",
    firstName: "Тест",
    lastName: "Сотрудников",
    middleName: "Тестович",
    fullName: "Сотрудников Тест Тестович",
    displayName: "Сотрудников Тест",
    email: "test.employee@yu.edu.kz",
    phone: "77000000000",
    image:
      "https://api.yu.edu.kz/uploads/users/test.employee/profile.jpg",
    isActive: true,
    isSuperuser: true,
    roles: ["admin", "personnel"],
    employedAt: "2025-07-24",
    orgUnit: {
      id: 24,
      nameRu: "Управление информационных технологий",
      nameKk: "Ақпараттық технологиялар басқармасы",
      nameEn: "Department of Information Technologies",
    },
    position: { id: 379, name: "Frontend-разработчик" },
  });
});

test("looks up an employee by exact IIN and does not send the token in the URL", async () => {
  let requestedUrl: URL | null = null;
  const fetcher = (async (input: URL | RequestInfo) => {
    requestedUrl = new URL(input instanceof URL ? input.href : String(input));
    return Response.json({
      count: 1,
      size: 1,
      next: null,
      previous: null,
      results: [directoryUser()],
    });
  }) as typeof fetch;
  const client = createYessenovDirectoryClient(fetcher, {
    YESSENOV_DIRECTORY_API_TOKEN: TOKEN,
  });

  assert.equal((await client.findEmployee("000000000000"))?.personnelId, 20001);
  const capturedUrl = requestedUrl as URL | null;
  assert.equal(capturedUrl?.searchParams.get("search"), "000000000000");
  assert.equal(capturedUrl?.href.includes(TOKEN), false);
  assert.equal(await client.findEmployee("invalid"), null);
});

test("fails closed without a token and rejects cross-origin pagination", async () => {
  const unconfigured = createYessenovDirectoryClient(async () => {
    throw new Error("fetch must not run");
  }, {});
  await assert.rejects(
    unconfigured.listEmployees(),
    (error: unknown) =>
      error instanceof YessenovDirectoryError &&
      error.reason === "not_configured",
  );

  const unsafe = createYessenovDirectoryClient(
    (async () =>
      Response.json({
        count: 0,
        size: 0,
        next: "https://example.com/steal-token",
        previous: null,
        results: [],
      })) as typeof fetch,
    { YESSENOV_DIRECTORY_API_TOKEN: TOKEN },
  );
  await assert.rejects(
    unsafe.listEmployees(),
    (error: unknown) =>
      error instanceof YessenovDirectoryError &&
      error.reason === "invalid_response",
  );
});

function directoryUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 10001,
    username: "test.employee",
    last_name: "Сотрудников",
    first_name: "Тест",
    email: "test.employee@yu.edu.kz",
    is_active: true,
    is_superuser: true,
    image: "https://api.yu.edu.kz/uploads/users/test.employee/profile.jpg",
    phone_number: null,
    role: ["admin", "personnel"],
    personnel: {
      id: 20001,
      last_name: "Сотрудников",
      first_name: "Тест",
      middle_name: "Тестович",
      full_name: "Сотрудников Тест Тестович",
      display_name: "Сотрудников Тест",
      mobile_phone: "77000000000",
      work_phone: null,
      employed_at: "2025-07-24",
      identify_code: "000000000000",
      is_active: true,
      main_position: {
        orgunit: {
          id: 24,
          name_ru: "Управление информационных технологий",
          name_kk: "Ақпараттық технологиялар басқармасы",
          name_en: "Department of Information Technologies",
        },
        position: { id: 379, name: "Frontend-разработчик" },
      },
    },
    ...overrides,
  };
}
