import TmcLanding from "@/components/TmcLanding";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { TMC_ENTRY_POINT } from "@/lib/tmc-navigation";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { toLocalBarcodeInventoryItem } from "@/lib/local-barcode-item-view";
import { toTmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TmcPage() {
  const user = await requireAuthorizedPage(TMC_ENTRY_POINT.href);
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const [history, serverItems, localGroups] = await Promise.all([
    services.tmcTransferRequests.listHistory({
      status: "pending",
      recipientId: user.userId,
      limit: 50,
    }, actor),
    services.items.listItems(actor),
    services.localBarcodes.listActiveGroupsAssignedTo(actor).catch(() => []),
  ]);
  const issueItems = [
    ...serverItems
    .map(toInventoryItemView)
    .filter((item) => item.status === "active" && item.responsibleId === user.userId),
    ...localGroups.map(toLocalBarcodeInventoryItem),
  ];
  return (
    <TmcLanding
      incomingRequests={history.requests.map(toTmcTransferRequestCardView)}
      issueItems={issueItems}
      actorUserId={user.userId}
      actorRole={user.role}
    />
  );
}
