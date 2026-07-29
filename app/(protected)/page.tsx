// Authentication for this route group is enforced by the adjacent layout.
import Dashboard from "@/components/Dashboard";
import { buildCampusMapData } from "@/lib/campus-map-data";
import { hasPermission } from "@/lib/security/permissions";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const currentUser = await requireAuthorizedPage("/");
  const services = getApplicationServices();
  const actor = authorizationActor(currentUser);
  const users = await services.users.listUsers();
  const canReadInventory = hasPermission(
    currentUser.role,
    "inventory.workspace.read",
  );
  const buildings = canReadInventory
    ? await services.locations.listBuildings(actor)
    : [];
  const [items, roomGroups] = canReadInventory
    ? await Promise.all([
        services.items.listItems(actor),
        Promise.all(
          buildings.map((building) =>
            services.locations.listRooms(building.id, actor),
          ),
        ),
      ])
    : [[], []];
  const rooms = roomGroups.flat();

  return (
    <Dashboard
      totalUsers={users.length}
      campus={buildCampusMapData(buildings, rooms, items)}
    />
  );
}
