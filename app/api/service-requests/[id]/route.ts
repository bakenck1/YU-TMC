import { getApplicationServices } from "@/lib/server/application";
import { createServiceRequestStatusPatchHandler } from "@/lib/server/http/service-request-status-handler";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { notifyServiceRequestByWhatsApp } from "@/lib/server/whatsapp-service-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patch = createServiceRequestStatusPatchHandler({
  authenticate: requireCurrentUser,
  updateStatus: async (serviceRequestId, status, version, actor) => {
    const updated = await getApplicationServices().requests.updateStatus(
      serviceRequestId,
      status,
      version,
      actor,
    );
    if (status !== "new") await notifyServiceRequestByWhatsApp(updated);
    return updated;
  },
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return patch(request, (await context.params).id);
}
