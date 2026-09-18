// Authentication for this route group is enforced by the adjacent layout.
import { notFound } from "next/navigation";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import ProblemReportButton from "@/components/ProblemReportButton";
import Wrapper from "@/components/Wrapper";
import { getApplicationServices } from "@/lib/server/application";
import { hasPermission } from "@/lib/security/permissions";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { isUuid } from "@/lib/domain/identifiers";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { canonicalInventoryDetailsReturnHref } from "@/lib/inventory-list-state";
import { canAccessPath } from "@/lib/security/authorization";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    edit?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const user = await requireAuthorizedPage(`/items/${id}`);
  const requestedReturnHref = canonicalInventoryDetailsReturnHref(
    resolvedSearchParams.returnTo,
  );
  const returnHref =
    requestedReturnHref && canAccessPath(user.role, requestedReturnHref)
      ? requestedReturnHref
      : undefined;

  if (isUuid(id)) {
    const actor = {
      userId: user.userId,
      role: user.role,
    };
    const services = getApplicationServices();
    const item = await readHiddenPageResource(
      () => services.items.findItem(id, actor),
      notFound,
    );
    if (item.itemSection !== "general") notFound();
    const canManageProtected = hasPermission(
      user.role,
      "inventory.item.manage_protected_fields",
    );
    const canEditContent = hasPermission(
      user.role,
      "inventory.item.edit_content",
    );
    const requestedEditor = Array.isArray(resolvedSearchParams.edit)
      ? resolvedSearchParams.edit[0]
      : resolvedSearchParams.edit;
    const canManageComponents = hasPermission(
      user.role,
      "inventory.item.manage_components",
    );
    const ownsItem = item.responsible?.id === user.userId;
    const canMutateAsEmployee = user.role !== "employee" || ownsItem;
    const canComment = canMutateAsEmployee && hasPermission(user.role, "inventory.item.comment");
    const [components, operations, comments, localGroups] = await readHiddenPageResource(
      () =>
        Promise.all([
          services.items.listComponents(id, actor),
          services.items.listOperations(id, actor),
          services.items.listComments(id, actor),
          user.role !== "employee" || ownsItem
            ? services.localBarcodes.getDistribution(id, actor).then((value) => value.groups)
            : Promise.resolve([]),
        ]),
      notFound,
    );
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
      <Wrapper direction="column" gap="md">
      <InventoryItemDetails
        initialItem={item}
        canEditContent={canEditContent}
        initialEditing={canEditContent && requestedEditor === "content"}
        canSendToService={canMutateAsEmployee && hasPermission(user.role, "inventory.item.send_to_service")}
        requiresServicePhoto
        canManageCode={hasPermission(user.role, "inventory.qr.manage")}
        operations={operations}
        initialComments={comments}
        canComment={canComment}
        canManageProtected={canManageProtected}
        rooms={rooms}
        initialComponents={components}
        localGroups={localGroups}
        canManageComponents={canManageComponents}
        actorId={user.userId}
        actorRole={user.role}
        returnHref={returnHref}
      />
      {user.role === "admin" || (user.role === "employee" && ownsItem) ? (
        <Wrapper width="full" responsive={{ at: "md", display: "inline-flex", width: "auto" }}>
          <ProblemReportButton
            items={[{ id: item.id, name: item.name, inventoryNumber: item.inventoryNumber }]}
            initialItemId={item.id}
            fullWidth
          />
        </Wrapper>
      ) : null}
      </Wrapper>
    );
  }

  notFound();
}
