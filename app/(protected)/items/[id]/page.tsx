// Authentication for this route group is enforced by the adjacent layout.
import { notFound } from "next/navigation";
import ItemDetails from "@/components/ItemDetails";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import ProblemReportButton from "@/components/ProblemReportButton";
import { items } from "@/lib/data";
import { getApplicationServices } from "@/lib/server/application";
import { hasPermission } from "@/lib/security/permissions";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/items/${id}`);

  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const actor = {
      userId: user.userId,
      role: user.role,
    };
    const services = getApplicationServices();
    const item = await services.items.findItem(id, actor);
    if (!isInventoryBuildingName(item.room.buildingName)) notFound();
    const canManageProtected = hasPermission(
      user.role,
      "inventory.item.manage_protected_fields",
    );
    const canManageComponents = hasPermission(
      user.role,
      "inventory.item.manage_components",
    );
    const canComment = hasPermission(user.role, "inventory.item.comment");
    const [components, operations, comments] = await Promise.all([
      services.items.listComponents(id, actor),
      services.items.listOperations(id, actor),
      services.items.listComments(id, actor),
    ]);
    const buildings = canManageProtected
      ? (await services.locations.listBuildings(actor)).filter((building) =>
          isInventoryBuildingName(building.name),
        )
      : [];
    const rooms = (
      await Promise.all(
        buildings.map(async (building) =>
          (await services.locations.listRooms(building.id, actor)).map((room) => ({
            ...room,
            buildingName: building.name,
          })),
        ),
      )
    ).flat();
    return (
      <div className="space-y-4">
      <InventoryItemDetails
        initialItem={item}
        canEditContent={hasPermission(user.role, "inventory.item.edit_content")}
        canSendToService={hasPermission(user.role, "inventory.item.send_to_service")}
        requiresServicePhoto
        canManageCode={hasPermission(user.role, "inventory.qr.manage")}
        operations={operations}
        initialComments={comments}
        canComment={canComment}
        canManageProtected={canManageProtected}
        rooms={rooms}
        initialComponents={components}
        canManageComponents={canManageComponents}
      />
      {user.role === "admin" || user.role === "employee" ? (
        <ProblemReportButton
          items={[{ id: item.id, name: item.name, inventoryNumber: item.inventoryNumber }]}
          initialItemId={item.id}
          className="w-full md:w-auto"
        />
      ) : null}
      </div>
    );
  }

  const item = items.find((entry) => entry.id === id);

  if (!item) notFound();

  return (
    <ItemDetails
      item={item}
      canManage={hasPermission(user.role, "inventory.item.edit_content")}
    />
  );
}
