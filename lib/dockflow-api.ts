import "server-only";

import { createDockflowService } from "@/lib/application/services/dockflow-service";
import type { DockflowDataRepository, DockflowEmployee, DockflowEmployeeItem, DockflowInventoryRepository, DockflowPageRequest } from "@/lib/contracts/dockflow";
import { externalJson, externalResponseHeaders, verifyExternalBearer } from "@/lib/server/http/external-api";
import { createPostgresDockflowInventoryRepository } from "@/lib/server/persistence/postgres/postgres-dockflow-inventory-repository";
import {
  createYessenovDirectoryClient,
  type YessenovDirectoryClient,
  YessenovDirectoryError,
} from "@/lib/yessenov-directory";


const json = externalJson;

function errorResponse(status: number, error: string, message: string, headers?: HeadersInit) {
  return json({ error, message }, status, headers);
}

export function authorizeDockflowRequest(request: Request): Response | null {
  const result = verifyExternalBearer(request, { current: process.env.DOCKFLOW_API_KEY, next: process.env.DOCKFLOW_API_KEY_NEXT });
  if (result === "not_configured") return errorResponse(503, "API_NOT_CONFIGURED", "API Dockflow не настроен.");
  if (result === "unauthorized") return errorResponse(401, "UNAUTHORIZED", "Отсутствует или неверно указан API-ключ.", { "WWW-Authenticate": "Bearer" });
  return null;
}

export function dockflowAuthCheck(request: Request) {
  return authorizeDockflowRequest(request) ?? json({ valid: true });
}

export async function listDockflowEmployees(request: Request, repository?: DockflowDataRepository) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const page = parsePage(request, "employees");
    if (page instanceof Response) return page;
    repository ??= createPostgresDockflowRepository();
    const rows = await repository.listEmployees();
    const employees = rows
      .filter((employee) => !page.after || employee.iin > page.after.sortValue)
      .slice(0, page.limit + 1);
    const returned = employees.slice(0, page.limit);
    const last = returned.at(-1);
    return json({
      employees: returned,
      nextCursor: employees.length > page.limit && last
        ? encodeCursor("employees", null, last.iin, last.iin)
        : null,
    });
  } catch (error) {
    return dependencyErrorResponse(error);
  }
}

export async function listDockflowItems(request: Request, repository?: DockflowDataRepository) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const page = parsePage(request, "items");
  if (page instanceof Response) return page;
  try {
    repository ??= createPostgresDockflowRepository();
    const items = await repository.listItems({ after: page.after, limit: page.limit + 1 });
    const returned = items.slice(0, page.limit);
    const last = returned.at(-1);
    return json({
      items: returned,
      nextCursor: items.length > page.limit && last
        ? encodeCursor("items", null, last.updatedAt, last.id)
        : null,
    });
  } catch { return errorResponse(503, "DEPENDENCY_UNAVAILABLE", "Dockflow dependency is unavailable.", { "Retry-After": "5" }); }
}

export async function findDockflowItemPhoto(
  request: Request,
  id: string,
  repository?: DockflowDataRepository,
) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return errorResponse(404, "ITEM_NOT_FOUND", "ТМЦ не найдено.");
  }

  if (request.headers.has("range")) {
    return errorResponse(416, "RANGE_NOT_SUPPORTED", "Byte ranges are not supported.", { "Accept-Ranges": "none" });
  }
  let photo;
  try { repository ??= createPostgresDockflowRepository(); photo = await repository.findItemPhoto(id); }
  catch { return errorResponse(503, "DEPENDENCY_UNAVAILABLE", "Dockflow dependency is unavailable.", { "Retry-After": "5" }); }
  if (!photo) {
    return errorResponse(404, "ITEM_PHOTO_NOT_FOUND", "Фото ТМЦ не найдено.");
  }
  return new Response(Uint8Array.from(photo.bytes), {
    headers: externalResponseHeaders({
      "Content-Type": photo.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "none",
    }),
  });
}

export async function findDockflowEmployee(request: Request, iin: string, repository?: DockflowDataRepository) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const validationError = validateIin(iin);
  if (validationError) return validationError;
  const page = parsePage(request, "employee_items", iin);
  if (page instanceof Response) return page;

  try {
    repository ??= createPostgresDockflowRepository();
    const employee = await repository.findEmployee(iin);
    if (!employee) return employeeNotFound();
    const rows = await repository.itemsForEmployee(iin, { after: page.after, limit: page.limit + 1 });
    const returned = rows.slice(0, page.limit);
    const last = returned.at(-1);
    return json({
      employee,
      items: applyDirectoryEmployeeName(returned, employee),
      nextCursor: rows.length > page.limit && last
        ? encodeCursor("employee_items", iin, last.assignedAt, last.id)
        : null,
    });
  } catch (error) {
    return dependencyErrorResponse(error);
  }
}

export async function findDockflowEmployeeItems(request: Request, iin: string, repository?: DockflowDataRepository) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const validationError = validateIin(iin);
  if (validationError) return validationError;
  const page = parsePage(request, "employee_items", iin);
  if (page instanceof Response) return page;
  try {
    repository ??= createPostgresDockflowRepository();
    const employee = await repository.findEmployee(iin);
    if (!employee) return employeeNotFound();
    const rows = await repository.itemsForEmployee(iin, { after: page.after, limit: page.limit + 1 });
    const returned = rows.slice(0, page.limit);
    const last = returned.at(-1);
    return json({
      items: applyDirectoryEmployeeName(returned, employee),
      nextCursor: rows.length > page.limit && last
        ? encodeCursor("employee_items", iin, last.assignedAt, last.id)
        : null,
    });
  } catch (error) {
    return dependencyErrorResponse(error);
  }
}

function validateIin(iin: string) {
  return /^\d{12}$/.test(iin)
    ? null
    : errorResponse(400, "INVALID_IIN", "ИИН должен содержать ровно 12 цифр.");
}

function employeeNotFound() {
  return errorResponse(404, "EMPLOYEE_NOT_FOUND", "Пользователь с указанным ИИН не найден.");
}

function dependencyErrorResponse(error: unknown): Response {
  if (!(error instanceof YessenovDirectoryError)) return errorResponse(503, "DEPENDENCY_UNAVAILABLE", "Dockflow dependency is unavailable.", { "Retry-After": "5" });
  return error.reason === "not_configured"
    ? errorResponse(
        503,
        "YESSENOV_DIRECTORY_NOT_CONFIGURED",
        "API справочника Yessenov ID не настроен.",
      )
    : errorResponse(
        502,
        "YESSENOV_DIRECTORY_UNAVAILABLE",
        "Не удалось получить данные сотрудников из Yessenov ID.",
        { "Retry-After": "5" },
      );
}

function applyDirectoryEmployeeName(
  items: DockflowEmployeeItem[],
  employee: DockflowEmployee,
) {
  return items.map((item) =>
    item.responsible?.iin === employee.iin
      ? {
          ...item,
          responsible: { iin: employee.iin, fullName: employee.fullName },
        }
      : item,
  );
}

/**
 * Employee profiles come from Yessenov ID. PostgreSQL remains the source of
 * inventory assignments and item counts, joined to directory users by IIN.
 */
export function createPostgresDockflowRepository(
  directory: YessenovDirectoryClient = createYessenovDirectoryClient(),
  inventory: DockflowInventoryRepository = createPostgresDockflowInventoryRepository(),
): DockflowDataRepository {
  return createDockflowService(directory, inventory);
}


type DockflowCursorKind = "employees" | "items" | "employee_items";

function parsePage(request: Request, kind: DockflowCursorKind, scope: string | null = null): DockflowPageRequest | Response {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor") || query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
  const rawLimit = query.get("limit") ?? "100";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
  const cursor = query.get("cursor");
  let after: DockflowPageRequest["after"] = null;
  if (cursor) {
    if (cursor.length > 256) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
    let payload: unknown;
    try { payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
    catch { return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters."); }
    if (!isCursorPayload(payload, kind, scope) || encodeCursor(payload[1], payload[2], payload[3], payload[4]) !== cursor) {
      return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
    }
    after = { sortValue: payload[3], id: payload[4] };
  }
  return { after, limit: Number(rawLimit) };
}

function encodeCursor(kind: DockflowCursorKind, scope: string | null, sortValue: string, id: string) {
  return Buffer.from(JSON.stringify([1, kind, scope, sortValue, id])).toString("base64url");
}

function isCursorPayload(
  value: unknown,
  kind: DockflowCursorKind,
  scope: string | null,
): value is [1, DockflowCursorKind, string | null, string, string] {
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== 1 || value[1] !== kind || value[2] !== scope) return false;
  const sortValue = value[3];
  const id = value[4];
  if (typeof sortValue !== "string" || typeof id !== "string") return false;
  if (kind === "employees") return /^\d{12}$/.test(sortValue) && id === sortValue;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sortValue)) return false;
  const parsedSortValue = new Date(sortValue);
  return !Number.isNaN(parsedSortValue.getTime())
    && parsedSortValue.toISOString() === sortValue
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export type { DockflowDataRepository, DockflowEmployee, DockflowEmployeeItem, DockflowInventoryItem, DockflowInventoryRepository, DockflowItemPhoto, DockflowMarkingType, DockflowPageRequest } from "@/lib/contracts/dockflow";
