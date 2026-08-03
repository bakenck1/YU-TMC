import { Buffer } from "node:buffer";

import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import {
  createInventoryTemplate,
  exportInspectionResults,
  exportInventoryItems,
  activeInventoryItems,
  parseInventoryWorkbook,
  type ImportRoom,
} from "@/lib/server/excel/inventory-excel";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const actor = authorizationActor(user);
    if (!hasPermission(user.role, "inventory.report.export")) throw forbidden();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    if (action === "template") {
      return workbookResponse(
        await createInventoryTemplate(await listImportRooms(actor)),
        "inventory-import-template.xlsx",
      );
    }
    if (action !== "export") throw invalidRequest();
    const dataset = url.searchParams.get("dataset");
    const services = getApplicationServices();
    if (dataset === "items") {
      return workbookResponse(
        await exportInventoryItems(activeInventoryItems(await services.items.listItems(actor)), "Inventory items"),
        "inventory-items.xlsx",
      );
    }
    if (dataset === "decommissioned") {
      return workbookResponse(
        await exportInventoryItems(await services.items.listDecommissionedItems(actor), "Decommissioned"),
        "decommissioned-items.xlsx",
      );
    }
    if (dataset === "inspection-results") {
      return workbookResponse(
        await exportInspectionResults(await services.inspections.list(actor)),
        "inspection-results.xlsx",
      );
    }
    throw invalidRequest();
  } catch (error) {
    return excelErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const actor = authorizationActor(user);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "export") {
      if (!hasPermission(user.role, "inventory.report.export")) throw forbidden();
      const body = (await request.json()) as {
        dataset?: string;
        itemIds?: unknown;
        columns?: unknown;
      };
      if (body.dataset !== "items" && body.dataset !== "decommissioned") throw invalidRequest();
      const itemIdsProvided = Array.isArray(body.itemIds);
      const rawItemIds: unknown[] = itemIdsProvided ? (body.itemIds as unknown[]) : [];
      const itemIds = rawItemIds.filter(isUuid).slice(0, 2_000);
      const rawColumns: unknown[] = Array.isArray(body.columns) ? (body.columns as unknown[]) : [];
      const columns = Array.isArray(body.columns)
        ? rawColumns.filter((value): value is string => typeof value === "string" && value.length <= 40).slice(0, 30)
        : undefined;
      const services = getApplicationServices();
      const source = body.dataset === "decommissioned"
        ? await services.items.listDecommissionedItems(actor)
        : activeInventoryItems(await services.items.listItems(actor));
      const selected = itemIdsProvided ? source.filter((item) => itemIds.includes(item.id)) : source;
      return workbookResponse(
        await exportInventoryItems(selected, body.dataset === "items" ? "Inventory items" : "Decommissioned", columns),
        body.dataset === "items" ? "inventory-items.xlsx" : "decommissioned-items.xlsx",
      );
    }
    if (action !== "preview" && action !== "import") throw invalidRequest();
    if (!hasPermission(user.role, "inventory.item.bulk_manage")) throw forbidden();
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_FILE_BYTES || !file.name.toLowerCase().endsWith(".xlsx")) {
      throw new ApplicationError("validation", "invalid_excel_file");
    }
    const parsed = await parseInventoryWorkbook(
      new Uint8Array(await file.arrayBuffer()),
      await listImportRooms(actor),
    );
    if (action === "preview") return Response.json({ preview: parsed.preview });
    if (parsed.preview.errors.length || parsed.inputs.length < 1) {
      throw new ApplicationError("validation", "excel_validation_failed");
    }
    const imported = await getApplicationServices().items.importItems(parsed.inputs, actor);
    return Response.json({ importedCount: imported.length }, { status: 201 });
  } catch (error) {
    return excelErrorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

async function listImportRooms(actor: ReturnType<typeof authorizationActor>): Promise<ImportRoom[]> {
  const services = getApplicationServices();
  const buildings = await services.locations.listBuildings(actor);
  return (
    await Promise.all(buildings.map(async (building) =>
      (await services.locations.listRooms(building.id, actor)).map((room) => ({
        ...room,
        buildingName: building.name,
      })),
    ))
  ).flat();
}

function workbookResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x-content-type-options": "nosniff",
    },
  });
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

function excelErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "excel_unavailable" }, { status: 503 });
}
