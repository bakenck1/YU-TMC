// Authentication for this route group is enforced by the adjacent layout.
import ItemsTable from "@/components/ItemsTable";
import EmployeeItemsTabs from "@/components/EmployeeItemsTabs";
import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import InventorySummaryAccordions from "@/components/InventorySummaryAccordions";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { hasPermission } from "@/lib/security/permissions";
import { isInventoryBuildingName } from "@/lib/campus-directory";

export default async function ItemsPage() {
  const user = await requireAuthorizedPage("/items");
  const actor = authorizationActor(user);
  const serverItems = await getApplicationServices().items.listItems(actor);
  const items = serverItems.map(toInventoryItemView);
  const canCreate = hasPermission(user.role, "inventory.item.create");
  const canExport = hasPermission(user.role, "inventory.report.export");
  let buildings: BuildingDto[] = [];
  let rooms: RoomDto[] = [];
  if (canCreate) {
    buildings = (await getApplicationServices().locations.listBuildings(actor)).filter(
      (building) => isInventoryBuildingName(building.name),
    );
    const roomLists = await Promise.all(
      buildings.map((building) =>
        getApplicationServices().locations.listRooms(building.id, actor),
      ),
    );
    rooms = roomLists.flat();
  }

  return (
    <div className="space-y-4">
      <InventorySummaryAccordions items={items} />
      {user.role === "employee" ? (
        <EmployeeItemsTabs
          items={items}
          searchHistoryScope={user.userId}
          columnSettingsScope={user.userId}
          actorUserId={user.userId}
          actorRole={user.role}
        />
      ) : (
        <ItemsTable
          items={items}
          searchHistoryScope={user.userId}
          columnSettingsScope={user.userId}
          excelDataset={canExport ? "items" : undefined}
          bulkActions={{
            actorUserId: user.userId,
            actorRole: user.role,
            buildings,
            rooms,
          }}
          headerActions={
            canCreate ? (
              <InventoryItemCreateForm rooms={rooms} buildings={buildings} />
            ) : null
          }
        />
      )}
    </div>
  );
}
