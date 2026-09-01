// Authentication for this route group is enforced by the adjacent layout.
import ItemsTable from "@/components/ItemsTable";
import EmployeeItemsTabs from "@/components/EmployeeItemsTabs";
import InventorySummaryAccordions from "@/components/InventorySummaryAccordions";
import Wrapper from "@/components/Wrapper";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { toLocalBarcodeInventoryItem } from "@/lib/local-barcode-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { hasPermission } from "@/lib/security/permissions";
import { isInventoryBuildingName } from "@/lib/campus-directory";

export default async function ItemsPage() {
  const user = await requireAuthorizedPage("/items");
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const [serverItems, localGroups] = await Promise.all([
    services.items.listItems(actor),
    user.role === "employee"
      ? services.localBarcodes.listActiveGroupsAssignedTo(actor)
      : Promise.resolve([]),
  ]);
  const originalRemainders = user.role === "employee"
    ? new Map(
        (await Promise.all(
          serverItems.map(async (item) => {
            const distribution = await services.localBarcodes.getDistribution(item.id, actor);
            return [item.id, distribution.originalRemainder] as const;
          }),
        )),
      )
    : new Map<string, number>();
  const items = [
    ...serverItems.map((item) => ({
      ...toInventoryItemView(item),
      quantity: originalRemainders.get(item.id) ?? item.quantity,
    })),
    ...localGroups.map(toLocalBarcodeInventoryItem),
  ];
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
    <Wrapper direction="column" gap="md">
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
          itemCreation={canCreate ? {
            rooms,
            buildings,
            mode: user.role === "warehouse" ? "restricted" : "full",
          } : undefined}
        />
      )}
    </Wrapper>
  );
}
