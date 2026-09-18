import type { RoomWorkspaceRepositories } from "@/lib/application/ports/room-workspace-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  PublicRoomDto,
  RoomWorkspaceDto,
} from "@/lib/contracts/room-workspace";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";
import type { AuthorizationActor } from "@/lib/security/permissions";

export class RoomWorkspaceService {
  constructor(private readonly unitOfWork: UnitOfWork<RoomWorkspaceRepositories>) {}

  async findPublicByQr(value: unknown): Promise<PublicRoomDto> {
    const canonicalKey = parseRoomQr(value);
    const room = await this.unitOfWork.read(({ rooms }) =>
      rooms.findRoomByQr(canonicalKey),
    );
    if (!room) throw new ApplicationError("not_found", "room_not_found");
    return { access: "authentication_required" };
  }

  async findByQr(value: unknown, actor: AuthorizationActor) {
    const canonicalKey = parseRoomQr(value);
    return this.unitOfWork.read(async ({ rooms }) => {
      const room = await rooms.findRoomByQr(canonicalKey);
      if (!room) throw new ApplicationError("not_found", "room_not_found");
      return buildWorkspace(room, actor, await rooms.listRoomItems(room.id));
    });
  }

  async findById(id: string, actor: AuthorizationActor) {
    if (!isUuid(id)) throw new ApplicationError("validation", "invalid_id");
    return this.unitOfWork.read(async ({ rooms }) => {
      const room = await rooms.findRoomById(id);
      if (!room) throw new ApplicationError("not_found", "room_not_found");
      return buildWorkspace(room, actor, await rooms.listRoomItems(room.id));
    });
  }
}

function buildWorkspace(
  room: Awaited<ReturnType<RoomWorkspaceRepositories["rooms"]["findRoomById"]>> & {},
  actor: AuthorizationActor,
  items: Awaited<ReturnType<RoomWorkspaceRepositories["rooms"]["listRoomItems"]>>,
): RoomWorkspaceDto {
  const privileged = actor.role === "admin" || actor.role === "warehouse";
  const ownItems = items.filter((item) => item.responsibleUserId === actor.userId);
  const fullAccess = privileged || room.accessMode === "open";
  if (!fullAccess && ownItems.length === 0) {
    return {
      access: "denied",
      items: [],
    };
  }
  const visibleItems = fullAccess ? items : ownItems;
  return {
    access: fullAccess ? "full" : "limited",
    id: room.id,
    designation: room.designation,
    buildingName: room.buildingName,
    floorNumber: room.floorNumber,
    floorLabel: room.floorLabel,
    responsibleName: room.primaryResponsibleName,
    itemCount: visibleItems.length,
    connectedCount: visibleItems.filter((item) => item.connectionStatus === "connected").length,
    disconnectedCount: visibleItems.filter((item) => item.connectionStatus === "disconnected").length,
    items: visibleItems.map((item) => ({
      id: item.id,
      name: item.name,
      inventoryNumber: item.inventoryNumber,
      description: item.description,
      status: item.status,
      condition: item.condition,
      connectionStatus: item.connectionStatus,
      responsibleName: item.responsibleName,
      photoUrl: item.hasPhoto ? `/api/inventory/items/${item.id}/photo` : null,
      createdAt: item.createdAt.toISOString(),
      href: item.href ?? `/items/${item.id}`,
    })),
  };
}

function parseRoomQr(value: unknown) {
  const parsed = parseQrIdentifierInput(value);
  if (!parsed.ok) throw new ApplicationError("validation", "invalid_qr");
  return parsed.canonicalKey;
}
