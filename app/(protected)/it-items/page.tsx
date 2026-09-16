import { redirect } from "next/navigation";
import ItemsTable from "@/components/ItemsTable";
import Wrapper from "@/components/Wrapper";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import {
  parseInventoryTableViewState,
  type InventorySearchParams,
} from "@/lib/inventory-list-state";

export default async function ItItemsPage({
  searchParams,
}: {
  searchParams: Promise<InventorySearchParams>;
}) {
  const user = await requireAuthenticatedPage();
  if (user.role !== "admin") redirect("/access-denied");
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const [serverItems, buildings] = await Promise.all([
    services.items.listItItems(actor),
    services.locations.listBuildings(actor),
  ]);
  const inventoryBuildings = buildings.filter((building) => isInventoryBuildingName(building.name));
  const rooms = (
    await Promise.all(inventoryBuildings.map((building) => services.locations.listRooms(building.id, actor)))
  ).flat();

  return (
    <Wrapper direction="column" gap="md">
      <ItemsTable
        items={serverItems.map(toInventoryItemView)}
        searchHistoryScope={`${user.userId}:it`}
        columnSettingsScope={`${user.userId}:it`}
        excelDataset="it-items"
        itemCreation={{ rooms, buildings: inventoryBuildings, mode: "full", section: "it" }}
        bulkActions={{ actorUserId: user.userId, actorRole: user.role, buildings: inventoryBuildings, rooms, itemSection: "it" }}
        locations={{ buildings: inventoryBuildings, rooms }}
        initialViewState={parseInventoryTableViewState(await searchParams)}
        stateUrlPath="/it-items"
        variant="it"
      />
    </Wrapper>
  );
}
