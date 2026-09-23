import { after } from "next/server";

import { createDormitoryRequest } from "@/lib/dormitory-requests-api";
import { getApplicationServices } from "@/lib/server/application";
import { observeHttpRequest } from "@/lib/server/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return observeHttpRequest(request, "/api/v1/dormitory/requests", () =>
    createDormitoryRequest(request, {
      onAccepted(result, description) {
        after(async () => {
          const services = getApplicationServices();
          const administrators = (await services.users.listUsers())
            .filter((user) => user.role === "admin" && user.active)
            .map((user) => user.id);
          await services.push.notifyMaintenanceRequest({
            itemId: result.item.id,
            itemName: result.item.name,
            inventoryNumber: result.item.inventoryNumber,
            reason: description,
            recipientIds: administrators,
          });
        });
      },
    }),
  );
}
