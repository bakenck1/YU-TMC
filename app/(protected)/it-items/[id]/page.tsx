import { notFound, redirect } from "next/navigation";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import Wrapper from "@/components/Wrapper";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { isUuid } from "@/lib/domain/identifiers";
import { canonicalInventoryDetailsReturnHref } from "@/lib/inventory-list-state";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";

export default async function ItItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ id }, query, user] = await Promise.all([
    params,
    searchParams,
    requireAuthenticatedPage(),
  ]);
  if (user.role !== "admin") redirect("/access-denied");
  if (!isUuid(id)) notFound();
  const actor = { userId: user.userId, role: user.role };
  const services = getApplicationServices();
  const item = await readHiddenPageResource(() => services.items.findItem(id, actor), notFound);
  if (item.itemSection !== "it") notFound();
  const [components, operations, comments, buildings] = await Promise.all([
    services.items.listComponents(id, actor),
    services.items.listOperations(id, actor),
    services.items.listComments(id, actor),
    services.locations.listBuildings(actor),
  ]);
  const inventoryBuildings = buildings.filter((building) => isInventoryBuildingName(building.name));
  const rooms = (
    await Promise.all(inventoryBuildings.map(async (building) =>
      (await services.locations.listRooms(building.id, actor)).map((room) => ({
        ...room,
        buildingName: building.name,
      })),
    ))
  ).flat();
  const requestedReturnHref = canonicalInventoryDetailsReturnHref(query.returnTo);
  const returnHref = requestedReturnHref === "/it-items" || requestedReturnHref?.startsWith("/it-items?")
    ? requestedReturnHref
    : "/it-items";

  return (
    <Wrapper direction="column" gap="md">
      <InventoryItemDetails
        initialItem={item}
        canEditContent
        canSendToService
        requiresServicePhoto
        canManageCode
        operations={operations}
        initialComments={comments}
        canComment
        canManageProtected
        rooms={rooms}
        initialComponents={components}
        canManageComponents
        actorId={user.userId}
        actorRole={user.role}
        returnHref={returnHref}
      />
    </Wrapper>
  );
}
