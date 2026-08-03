// Authentication for this route group is enforced by the adjacent layout.
import ItemsTable from "@/components/ItemsTable";
import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import InventorySummaryAccordions from "@/components/InventorySummaryAccordions";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { hasPermission } from "@/lib/security/permissions";

export default async function ItemsPage() {
  const user = await requireAuthorizedPage("/items");
  const actor = authorizationActor(user);
  const serverItems = await getApplicationServices().items.listItems(actor);
  const items = serverItems.map(toInventoryItemView);
  let buildings: BuildingDto[] = [];
  let rooms: RoomDto[] = [];
  if (hasPermission(user.role, "inventory.item.create")) {
    buildings = await getApplicationServices().locations.listBuildings(actor);
    const roomLists = await Promise.all(
      buildings.map((building) =>
        getApplicationServices().locations.listRooms(building.id, actor),
      ),
    );
    rooms = roomLists.flat();
  }

  return (
    <div className="space-y-4">
      {hasPermission(user.role, "inventory.item.create") ? (
        <div className="flex justify-end">
          <InventoryItemCreateForm rooms={rooms} buildings={buildings} />
        </div>
      ) : null}
      <InventorySummaryAccordions items={items} />
      <ItemsTable
        items={items}
        searchHistoryScope={user.userId}
        columnSettingsScope={user.userId}
      />
    </div>
  );
}
