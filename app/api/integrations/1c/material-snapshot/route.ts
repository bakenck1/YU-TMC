import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedFormData } from "@/lib/server/http/request-body";
import { MAX_MATERIAL_SNAPSHOT_BYTES } from "@/lib/server/material-snapshot";
import { getSelectedMaterialSnapshot, uploadMaterialSnapshot } from "@/lib/server/material-snapshot-service";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    return Response.json({ snapshot: await getSelectedMaterialSnapshot() }, { headers: noStore });
  } catch (error) { return applicationErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission(request, "inventory.integration.one_c.manage");
    const form = await readLimitedFormData(request, MAX_MATERIAL_SNAPSHOT_BYTES + 64 * 1024, { timeoutMs: 60_000 });
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_MATERIAL_SNAPSHOT_BYTES) {
      throw new ApplicationError("validation", "invalid_material_snapshot_file");
    }
    const snapshot = await uploadMaterialSnapshot(file.name, Buffer.from(await file.arrayBuffer()), user.userId);
    return Response.json({ snapshot }, { status: 201, headers: noStore });
  } catch (error) { return applicationErrorResponse(error); }
}
