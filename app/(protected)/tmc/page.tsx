import TmcLanding from "@/components/TmcLanding";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { TMC_ENTRY_POINT } from "@/lib/tmc-navigation";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { toTmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TmcPage() {
  const user = await requireAuthorizedPage(TMC_ENTRY_POINT.href);
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const [history, serverItems] = await Promise.all([
    services.tmcTransferRequests.listHistory({
      status: "pending",
      recipientId: user.userId,
      limit: 50,
    }, actor),
    services.items.listItems(actor),
  ]);
  const issueItems = serverItems
    .map(toInventoryItemView)
    .filter((item) => item.status === "active" && item.responsibleId === user.userId);
  return (
    <TmcLanding
      incomingRequests={history.requests.map(toTmcTransferRequestCardView)}
      issueItems={issueItems}
      actorUserId={user.userId}
      actorRole={user.role}
    />
  );
}
