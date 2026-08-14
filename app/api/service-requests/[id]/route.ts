import { getApplicationServices } from "@/lib/server/application";
import { createServiceRequestStatusPatchHandler } from "@/lib/server/http/service-request-status-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patch = createServiceRequestStatusPatchHandler({
  authenticate: requireCurrentUser,
  updateStatus: (serviceRequestId, status, version, actor) =>
    getApplicationServices().requests.updateStatus(
      serviceRequestId,
      status,
      version,
      actor,
    ),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return patch(request, (await context.params).id);
}
