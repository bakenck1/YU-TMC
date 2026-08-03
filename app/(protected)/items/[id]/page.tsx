// Authentication for this route group is enforced by the adjacent layout.
import { notFound } from "next/navigation";
import ItemDetails from "@/components/ItemDetails";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import { items } from "@/lib/data";
import { getApplicationServices } from "@/lib/server/application";
import { hasPermission } from "@/lib/security/permissions";
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
      ? await services.locations.listBuildings(actor)
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
      <InventoryItemDetails
        initialItem={item}
        canEditContent={hasPermission(user.role, "inventory.item.edit_content")}
        canSendToService={hasPermission(user.role, "inventory.item.send_to_service")}
        operations={operations}
        initialComments={comments}
        canComment={canComment}
        canManageProtected={canManageProtected}
        rooms={rooms}
        initialComponents={components}
        canManageComponents={canManageComponents}
      />
    );
  }

  const item = items.find((entry) => entry.id === id);

  if (!item) notFound();

  return <ItemDetails item={item} />;
}
