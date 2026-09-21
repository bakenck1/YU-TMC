import { createOneCReconciliationAdminHandlers } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { oneCReconciliationAdminDependencies } from "@/lib/server/http/one-c-reconciliation-admin-runtime";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export const POST=createOneCReconciliationAdminHandlers(oneCReconciliationAdminDependencies).publishBatch;
