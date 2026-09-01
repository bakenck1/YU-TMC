import { notFound } from "next/navigation";
import InventoryItemDetails from "@/components/InventoryItemDetails";
import Wrapper from "@/components/Wrapper";
import type { InventoryItemDto, InventoryItemOperationDto } from "@/lib/contracts/inventory-items";
import type { LocalBarcodeGroupDto, LocalBarcodeHistoryEventDto } from "@/lib/contracts/local-barcodes";
import { isUuid } from "@/lib/domain/identifiers";
import { categoryFromLegacyType } from "@/lib/inventory-categories";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LocalBarcodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/local-barcodes/${id}`);
  if (!isUuid(id)) notFound();
  const actor = authorizationActor(user);
  const [group, history] = await readHiddenPageResource(
    () =>
      Promise.all([
        getApplicationServices().localBarcodes.getGroup(id, actor),
        getApplicationServices().localBarcodes.getHistory(id, actor),
      ]),
    notFound,
  );

  return (
    <Wrapper direction="column" gap="md">
      <InventoryItemDetails
        initialItem={toLocalInventoryItem(group)}
        canEditContent={false}
        canSendToService={false}
        requiresServicePhoto={false}
        canManageCode={false}
        operations={toLocalOperations(history)}
        initialComments={[]}
        canComment={false}
        canManageProtected={false}
        rooms={[]}
        initialComponents={[]}
        canManageComponents={false}
        actorId={user.userId}
        actorRole={user.role}
        localBarcodeInfo={{
          originalBarcode: group.originalBarcode,
          transferredAt: group.transferredAt,
        }}
        localBarcodeItemId={group.itemId}
        hideComposition
      />
    </Wrapper>
  );
}

function toLocalInventoryItem(group: LocalBarcodeGroupDto): InventoryItemDto {
  return {
    id: group.id,
    name: group.itemName,
    description: group.description,
    category: group.itemType.trim().toLocaleLowerCase("ru-RU") === "furniture"
      ? "furniture"
      : categoryFromLegacyType(group.itemType),
    itemType: group.itemType,
    brand: group.brand,
    model: group.model,
    quantity: group.quantity,
    unitPrice: group.unitPrice,
    inventoryNumberKind: "official",
    inventoryNumber: group.localBarcode,
    room: {
      id: group.location.roomId,
      designation: group.location.roomDesignation,
      floorNumber: 0,
      buildingId: group.location.buildingId,
      buildingName: group.location.buildingName,
    },
    status: group.status === "cancelled" ? "decommissioned" : "active",
    condition: "good",
    connectionStatus: "not_applicable",
    qrCode: null,
    responsible: { id: group.responsible.id, name: group.responsible.fullName },
    photoUrl: group.photoUrl,
    servicePhotoUrl: null,
    version: group.version,
    createdAt: group.transferredAt,
    updatedAt: group.transferredAt,
    maintenanceStartedAt: null,
    archivedAt: group.status === "cancelled" ? group.cancellation?.cancelledAt ?? null : null,
  };
}

function toLocalOperations(
  history: LocalBarcodeHistoryEventDto[],
): InventoryItemOperationDto[] {
  return history.map((event) => ({
    id: event.id,
    kind: "transfer",
    action: event.type === "cancelled" ? "transfer.cancelled" : event.type === "transferred" ? "transfer.confirmed" : "transfer.requested",
    actorName: event.actor.fullName,
    actorEmail: null,
    occurredAt: event.occurredAt,
    detail: {
      targetName: event.toResponsible?.fullName,
      fromLocation: event.fromResponsible?.fullName,
      toLocation: event.toResponsible?.fullName,
      comment: event.reason ?? undefined,
    },
  }));
}
