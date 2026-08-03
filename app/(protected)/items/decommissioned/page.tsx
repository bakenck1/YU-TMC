import DecommissionedItemsView from "@/components/DecommissionedItemsView";
import { toDecommissionedInventoryItemView } from "@/lib/inventory-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";

export const dynamic = "force-dynamic";

export default async function DecommissionedItemsPage() {
  const user = await requireAuthorizedPage("/items/decommissioned");
  const items = await getApplicationServices().items.listDecommissionedItems(
    authorizationActor(user),
  );
  return (
    <DecommissionedItemsView
      items={items.map(toDecommissionedInventoryItemView)}
      canExport={hasPermission(user.role, "inventory.report.export")}
    />
  );
}
