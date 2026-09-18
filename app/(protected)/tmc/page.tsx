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
  const ownedServerItems = serverItems.filter(
    (item) => item.responsible?.id === user.userId,
  );
  const originalRemainders = new Map(
    await Promise.all(
      ownedServerItems.map(async (item) => {
        const distribution = await services.localBarcodes.getDistribution(item.id, actor);
        return [item.id, distribution.originalRemainder] as const;
      }),
    ),
  );
  const issueItems = [
    ...ownedServerItems
      .map((item) => ({
        ...toInventoryItemView(item),
        quantity: originalRemainders.get(item.id) ?? item.quantity,
      }))
      .filter((item) => (item.quantity ?? 0) > 0),
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
