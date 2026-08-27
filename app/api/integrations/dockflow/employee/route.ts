import { randomUUID } from "node:crypto";

import { getApplicationServices } from "@/lib/server/application";
import {
  DockflowValidationError,
  type DockflowAuthorization,
} from "@/lib/server/dockflow-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let authorization: DockflowAuthorization | null = null;
  const dockflow = getApplicationServices().dockflow;

  try {
    authorization = await dockflow.authorize(request.headers.get("x-api-key"));
    if (!authorization) {
      return await responseWithAudit({
        requestId,
        startedAt,
        authorization,
        status: 401,
        result: "INVALID_API_KEY",
        body: errorBody(requestId, "INVALID_API_KEY", "Недействительный API-ключ"),
      });
    }

    const url = new URL(request.url);
    const iin = url.searchParams.get("iin") ?? "";
    const fullName = url.searchParams.get("fullName") ?? "";
    const email = url.searchParams.get("email") ?? "";
    const clearance = await dockflow.checkEmployee({ iin, fullName, email });
    if (!clearance) {
      return await responseWithAudit({
        requestId,
        startedAt,
        authorization,
        status: 404,
        result: "EMPLOYEE_NOT_FOUND",
        body: errorBody(requestId, "EMPLOYEE_NOT_FOUND", "Сотрудник не найден"),
      });
    }

    return await responseWithAudit({
      requestId,
      startedAt,
      authorization,
      status: 200,
      result: clearance.clearanceStatus,
      body: {
        requestId,
        checkedAt: new Date().toISOString(),
        ...clearance,
      },
    });
  } catch (error) {
    if (error instanceof DockflowValidationError) {
      return await responseWithAudit({
        requestId,
        startedAt,
        authorization,
        status: 400,
        result: "INVALID_REQUEST",
        body: errorBody(requestId, "INVALID_REQUEST", "Некорректные параметры запроса"),
      });
    }
    const unavailable = isDatabaseError(error);
    return await responseWithAudit({
      requestId,
      startedAt,
      authorization,
      status: unavailable ? 503 : 500,
      result: unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
      body: errorBody(
        requestId,
        unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
        unavailable ? "Сервис временно недоступен" : "Внутренняя ошибка сервиса",
      ),
    });
  }
}

function errorBody(requestId: string, code: string, message: string) {
  return { requestId, error: { code, message } };
}

async function responseWithAudit(input: {
  requestId: string;
  startedAt: number;
  authorization: DockflowAuthorization | null;
  status: number;
  result: string;
  body: unknown;
}): Promise<Response> {
  try {
    await getApplicationServices().dockflow.logRequest({
      requestId: input.requestId,
      authorization: input.authorization,
      result: input.result,
      httpStatus: input.status,
      durationMs: performance.now() - input.startedAt,
    });
  } catch {
    // Audit persistence must not leak database details or replace the API result.
  }
  return Response.json(input.body, {
    status: input.status,
    headers: NO_STORE_HEADERS,
  });
}

function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("ECONN"));
}
