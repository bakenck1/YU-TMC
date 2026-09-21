import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import type { OneCReconciliationAdminService } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const oneCReconciliationAdminDependencies = {
  authenticate: async (request: Request) => authorizationActor(
    await requirePermission(request, "inventory.integration.one_c.manage"),
  ),
  service: (): OneCReconciliationAdminService => {
    const services = getApplicationServices() as ReturnType<typeof getApplicationServices> & {
      oneCReconciliation?: OneCReconciliationAdminService;
    };
    if (!services.oneCReconciliation) {
      throw new ApplicationError("unavailable", "one_c_reconciliation_unavailable");
    }
    return services.oneCReconciliation;
  },
};
