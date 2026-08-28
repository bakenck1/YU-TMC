import { getApplicationServices } from "@/lib/server/application";
import {
  DockflowValidationError,
} from "@/lib/server/dockflow-service";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { requirePermission } from "@/lib/server/security/request-user";
import { ApplicationError } from "@/lib/domain/application-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function GET(request: Request): Promise<Response> {
  try {
    await requirePermission(request, "legacy.settings.manage");
    const dockflow = getApplicationServices().dockflow;
    const [keys, auditSettings] = await Promise.all([
      dockflow.listKeys(),
      dockflow.getAuditSettings(),
    ]);
    return Response.json(
      { keys, auditSettings },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor = await requirePermission(request, "legacy.settings.manage");
    const input = await readLimitedJson(request, 1024);
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => key !== "retentionDays" && key !== "includeKeyPrefix") ||
      typeof body.retentionDays !== "number" ||
      typeof body.includeKeyPrefix !== "boolean"
    ) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const auditSettings = await getApplicationServices().dockflow.updateAuditSettings(
      {
        retentionDays: body.retentionDays,
        includeKeyPrefix: body.includeKeyPrefix,
      },
      actor.userId,
    );
    return Response.json({ auditSettings }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    return adminErrorResponse(
      error instanceof DockflowValidationError
        ? new ApplicationError("validation", "invalid_request")
        : error,
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const actor = await requirePermission(request, "legacy.settings.manage");
    const revoked = await getApplicationServices().dockflow.revokeActiveKey(actor.userId);
    return revoked
      ? new Response(null, { status: 204, headers: PRIVATE_NO_STORE_HEADERS })
      : Response.json(
          { error: { code: "ACTIVE_KEY_NOT_FOUND", message: "Действующий ключ не найден" } },
          { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
        );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

function adminErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_NO_STORE_HEADERS)
    : Response.json(
        { error: { code: "DOCKFLOW_KEY_UNAVAILABLE", message: "Управление ключом временно недоступно" } },
        { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
      );
}
