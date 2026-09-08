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
    const page = parsePage(request);
    if (page instanceof Response) return page;
    repository ??= createPostgresDockflowRepository();
    const rows = await repository.listEmployees();
    const employees = rows.slice(page.offset, page.offset + page.limit + 1);
    return json({ employees: employees.slice(0, page.limit), nextCursor: employees.length > page.limit ? encodeOffset(page.offset + page.limit) : null });
  } catch (error) {
    return dependencyErrorResponse(error);
  }
}

export async function listDockflowItems(request: Request, repository?: DockflowDataRepository) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;
  const page = parsePage(request);
  if (page instanceof Response) return page;
  try {
    repository ??= createPostgresDockflowRepository();
    const items = await repository.listItems({ offset: page.offset, limit: page.limit + 1 });
    return json({ items: items.slice(0, page.limit), nextCursor: items.length > page.limit ? encodeOffset(page.offset + page.limit) : null });
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
  const page = parsePage(request);
  if (page instanceof Response) return page;

  try {
    repository ??= createPostgresDockflowRepository();
    const employee = await repository.findEmployee(iin);
    if (!employee) return employeeNotFound();
    const rows = await repository.itemsForEmployee(iin, { offset: page.offset, limit: page.limit + 1 });
    return json({
      employee,
      items: applyDirectoryEmployeeName(rows.slice(0, page.limit), employee),
      nextCursor: rows.length > page.limit ? encodeOffset(page.offset + page.limit) : null,
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
  const page = parsePage(request);
  if (page instanceof Response) return page;
  try {
    repository ??= createPostgresDockflowRepository();
    const employee = await repository.findEmployee(iin);
    if (!employee) return employeeNotFound();
    const rows = await repository.itemsForEmployee(iin, { offset: page.offset, limit: page.limit + 1 });
    return json({
      items: applyDirectoryEmployeeName(rows.slice(0, page.limit), employee),
      nextCursor: rows.length > page.limit ? encodeOffset(page.offset + page.limit) : null,
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


function parsePage(request: Request): DockflowPageRequest | Response {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "limit" && key !== "cursor") || query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
  const rawLimit = query.get("limit") ?? "100";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
  const cursor = query.get("cursor");
  let offset = 0;
  if (cursor) {
    if (cursor.length > 64) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
    try { offset = Number(Buffer.from(cursor, "base64url").toString("utf8")); }
    catch { return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters."); }
    if (!Number.isSafeInteger(offset) || offset < 0 || encodeOffset(offset) !== cursor) return errorResponse(400, "INVALID_PAGE", "Invalid pagination parameters.");
  }
  return { offset, limit: Number(rawLimit) };
}

function encodeOffset(offset: number) { return Buffer.from(String(offset)).toString("base64url"); }

export type { DockflowDataRepository, DockflowEmployee, DockflowEmployeeItem, DockflowInventoryItem, DockflowInventoryRepository, DockflowItemPhoto, DockflowMarkingType, DockflowPageRequest } from "@/lib/contracts/dockflow";
