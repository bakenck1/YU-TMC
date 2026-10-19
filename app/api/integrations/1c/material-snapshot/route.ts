import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { getMaterialRegistryMetadata } from "@/lib/server/one-c-material-registry";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    return Response.json({ source: await getMaterialRegistryMetadata(), excelUploadEnabled: false }, { headers: noStore });
  } catch (error) { return applicationErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    return Response.json({ error: "material_excel_upload_retired", source: "materials_api" }, { status: 410, headers: noStore });
  } catch (error) { return applicationErrorResponse(error); }
}
