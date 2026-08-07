import ServiceRequestsManager from "@/components/ServiceRequestsManager";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const user = await requireAuthenticatedPage();
  const requests = await getApplicationServices().requests.list({}, authorizationActor(user));
  return <ServiceRequestsManager initialRequests={requests} canManage={user.role === "admin"} />;
}
