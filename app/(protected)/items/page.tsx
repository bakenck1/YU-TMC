// Authentication for this route group is enforced by the adjacent layout.
import ItemsTable from "@/components/ItemsTable";
import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import type { InventoryItem } from "@/lib/types";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { hasPermission } from "@/lib/security/permissions";

export default async function ItemsPage() {
  const user = await requireAuthorizedPage("/items");
  const actor = authorizationActor(user);
  const serverItems = await getApplicationServices().items.listItems(actor);
  let rooms: RoomDto[] = [];
  if (hasPermission(user.role, "inventory.item.create")) {
    const buildings = await getApplicationServices().locations.listBuildings(actor);
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
          <InventoryItemCreateForm rooms={rooms} />
        </div>
      ) : null}
      <ItemsTable items={serverItems.map(toLegacyItem)} />
    </div>
  );
}

function toLegacyItem(item: InventoryItemDto): InventoryItem {
  return {
    id: item.id,
    name: item.name,
    inventoryNumber: item.inventoryNumber,
    category: item.itemType as InventoryItem["category"],
    location: `${item.room.buildingName} / ${item.room.designation}`,
    responsible: item.responsible?.name ?? "",
    status: item.status,
    photoColor: "#0ea5e9",
    qrCode: item.qrCode ?? undefined,
    photo: item.photoUrl ?? undefined,
    displayStatus:
      item.inventoryNumberKind === "temporary"
        ? "Требует присвоения номера"
        : undefined,
    updatedAt: new Date(item.updatedAt).toLocaleDateString(),
    itemType: item.itemType,
    brandModel: [item.brand, item.model].filter(Boolean).join(" / ") || item.name,
    quantity: item.quantity,
    price: item.unitPrice,
  };
}
