import InventoryInspectionsManager from "@/components/InventoryInspectionsManager";
import MaintenanceItemsPanel from "@/components/MaintenanceItemsPanel";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { hasPermission } from "@/lib/security/permissions";
import { isInventoryBuildingName } from "@/lib/campus-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InventoryInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ inspection?: string | string[] }>;
}) {
  const requestedInspection = (await searchParams).inspection;
  const user = await requireAuthorizedPage("/inventory/inspections");
  const actor = authorizationActor(user);
  const services = getApplicationServices();
  const canReadWorkspace = hasPermission(
    actor.role,
    "inventory.workspace.read",
  );
  const [inspections, buildings, users, inventoryItems] = await Promise.all([
    services.inspections.list(actor),
    canReadWorkspace
      ? services.locations.listBuildings(actor).then((buildings) =>
          buildings.filter((building) => isInventoryBuildingName(building.name)),
        )
      : Promise.resolve([]),
    user.role === "admin" ? services.users.listUsers() : Promise.resolve([]),
    services.items.listItems(actor),
  ]);
  const roomLists = await Promise.all(
    buildings.map((building) => services.locations.listRooms(building.id, actor)),
  );
  const assignableUsers =
    user.role === "admin"
      ? users
          .filter(
            (candidate) =>
              candidate.active &&
              (candidate.role === "warehouse" ||
                candidate.role === "employee"),
          )
          .map((candidate) => ({
            id: candidate.id,
            fullName: candidate.fullName,
            role: candidate.role as "warehouse" | "employee",
          }))
      : user.role === "warehouse" || user.role === "employee"
        ? [{ id: user.userId, fullName: user.name, role: user.role }]
        : [];
  return (
    <div className="space-y-5">
      <MaintenanceItemsPanel initialItems={inventoryItems.filter((item) => item.status === "maintenance")} canManage={user.role === "admin"} />
      <InventoryInspectionsManager
      actorRole={user.role}
      currentUserId={user.userId}
      initialInspections={inspections}
      initialInspectionId={
        typeof requestedInspection === "string" &&
        inspections.some((inspection) => inspection.id === requestedInspection)
          ? requestedInspection
          : null
      }
      rooms={roomLists.flat()}
      technicians={assignableUsers}
      canExport={user.role === "admin"}
      />
    </div>
  );
}
