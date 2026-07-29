import InventoryInspectionsManager from "@/components/InventoryInspectionsManager";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InventoryInspectionsPage() {
  const user = await requireAuthorizedPage("/inventory");
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const [inspections, buildings] = await Promise.all([
    services.inspections.list(actor),
    services.locations.listBuildings(actor),
  ]);
  const roomLists = await Promise.all(
    buildings.map((building) => services.locations.listRooms(building.id, actor)),
  );
  return (
    <InventoryInspectionsManager
      initialInspections={inspections}
      rooms={roomLists.flat()}
    />
  );
}
