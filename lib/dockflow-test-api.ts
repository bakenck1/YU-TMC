import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export type DockflowMarkingType =
  | "individual"
  | "batch"
  | "package_or_storage";

export interface DockflowEmployee {
  iin: string;
  fullName: string;
  phone: string;
  login: string;
}

export interface DockflowIssueHistoryEntry {
  issuedAt: string;
  quantity: number;
  employeeIin: string;
}

export interface DockflowEmployeeItem {
  id: string;
  name: string;
  barcode: string;
  inventoryNumber: string;
  quantity: number;
  status: "assigned";
  storageLocation: string;
  assignedAt: string;
  cost: number;
  markingType: DockflowMarkingType;
  issueHistory: DockflowIssueHistoryEntry[];
}

export interface DockflowInventoryItem {
  id: string;
  name: string;
  barcode: string;
  inventoryNumber: string;
  quantity: number;
  availableQuantity: number;
  status: "assigned" | "in_stock";
  storageLocation: string;
  cost: number;
  markingType: DockflowMarkingType;
  assignments: Array<{
    employeeIin: string;
    quantity: number;
    assignedAt: string;
  }>;
  issueHistory: DockflowIssueHistoryEntry[];
}

const employees: readonly DockflowEmployee[] = Object.freeze([
  {
    iin: "990101123456",
    fullName: "Тестовый сотрудник",
    phone: "+77001234567",
    login: "dockflow.test",
  },
  {
    iin: "990101654321",
    fullName: "Тестовый сотрудник 2",
    phone: "+77007654321",
    login: "dockflow.test2",
  },
]);

function createInventoryItem(
  input: Omit<DockflowInventoryItem, "availableQuantity" | "status">,
): DockflowInventoryItem {
  const assignedQuantity = input.assignments.reduce(
    (total, assignment) => total + assignment.quantity,
    0,
  );
  if (assignedQuantity > input.quantity) {
    throw new Error("Dockflow fixture assignments exceed the batch quantity");
  }

  return {
    ...input,
    availableQuantity: input.quantity - assignedQuantity,
    status: assignedQuantity > 0 ? "assigned" : "in_stock",
  };
}

const inventoryItems: readonly DockflowInventoryItem[] = Object.freeze([
  createInventoryItem({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Стул офисный",
    barcode: "DF-000001",
    inventoryNumber: "INV-2026-001",
    quantity: 50,
    storageLocation: "Корпус A, кабинет 205",
    cost: 45000,
    markingType: "batch",
    assignments: [
      {
        employeeIin: "990101123456",
        quantity: 38,
        assignedAt: "2026-08-28T10:00:00Z",
      },
      {
        employeeIin: "990101654321",
        quantity: 4,
        assignedAt: "2026-08-28T10:00:00Z",
      },
    ],
    issueHistory: [],
  }),
  createInventoryItem({
    id: "00000000-0000-4000-8000-000000000002",
    name: "Бумага офисная A4",
    barcode: "DF-000002",
    inventoryNumber: "INV-2026-002",
    quantity: 20,
    storageLocation: "Склад, стеллаж B-04",
    cost: 3200,
    markingType: "package_or_storage",
    assignments: [],
    issueHistory: [],
  }),
]);

const JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Content-Type": "application/json; charset=utf-8",
} as const;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function errorResponse(
  status: number,
  error: string,
  message: string,
  headers?: HeadersInit,
) {
  return json({ error, message }, status, headers);
}

function configuredApiKey() {
  const value = process.env.DOCKFLOW_TEST_API_KEY?.trim();
  return value || null;
}

function secretsEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function authorizeDockflowRequest(request: Request): Response | null {
  const apiKey = configuredApiKey();
  if (!apiKey) {
    return errorResponse(
      503,
      "API_NOT_CONFIGURED",
      "Тестовый API Dockflow не настроен.",
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match || !secretsEqual(match[1], apiKey)) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Отсутствует или неверно указан API-ключ.",
      { "WWW-Authenticate": "Bearer" },
    );
  }

  return null;
}

export function dockflowAuthCheck(request: Request) {
  const unauthorized = authorizeDockflowRequest(request);
  return unauthorized ?? json({ valid: true });
}

export function listDockflowEmployees(request: Request) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;

  return json({
    employees: employees.map((employee) => ({
      ...employee,
      itemCount: inventoryItems.reduce(
        (total, item) =>
          total +
          item.assignments.filter(
            (assignment) => assignment.employeeIin === employee.iin,
          ).length,
        0,
      ),
    })),
  });
}

export function listDockflowItems(request: Request) {
  const unauthorized = authorizeDockflowRequest(request);
  return unauthorized ?? json({ items: inventoryItems });
}

export function findDockflowEmployee(request: Request, iin: string) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;

  const validationError = validateIin(iin);
  if (validationError) return validationError;

  const employee = employees.find((candidate) => candidate.iin === iin);
  if (!employee) {
    return errorResponse(
      404,
      "EMPLOYEE_NOT_FOUND",
      "Пользователь с указанным ИИН не найден.",
    );
  }

  return json({ employee, items: itemsForEmployee(iin) });
}

export function findDockflowEmployeeItems(request: Request, iin: string) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;

  const validationError = validateIin(iin);
  if (validationError) return validationError;

  if (!employees.some((employee) => employee.iin === iin)) {
    return errorResponse(
      404,
      "EMPLOYEE_NOT_FOUND",
      "Пользователь с указанным ИИН не найден.",
    );
  }

  return json({ items: itemsForEmployee(iin) });
}

function validateIin(iin: string) {
  if (/^\d{12}$/.test(iin)) return null;
  return errorResponse(
    400,
    "INVALID_IIN",
    "ИИН должен содержать ровно 12 цифр.",
  );
}

function itemsForEmployee(iin: string): DockflowEmployeeItem[] {
  return inventoryItems.flatMap((item) =>
    item.assignments
      .filter((assignment) => assignment.employeeIin === iin)
      .map((assignment) => ({
        id: item.id,
        name: item.name,
        barcode: item.barcode,
        inventoryNumber: item.inventoryNumber,
        quantity: assignment.quantity,
        status: "assigned" as const,
        storageLocation: item.storageLocation,
        assignedAt: assignment.assignedAt,
        cost: item.cost,
        markingType: item.markingType,
        issueHistory: item.issueHistory,
      })),
  );
}
