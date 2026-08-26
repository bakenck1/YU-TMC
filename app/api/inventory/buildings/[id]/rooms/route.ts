import { getApplicationServices } from "@/lib/server/application";
import { createInventoryRoomPostHandler } from "@/lib/server/http/inventory-room-handler";
import {
  authorizationActor,
  requirePermission,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const post = createInventoryRoomPostHandler({
  authenticate: async (request) =>
    authorizationActor(await requirePermission(request, "inventory.room.create")),
  createRoom: (buildingId, input, actor) =>
    getApplicationServices().locations.createRoom(buildingId, input, actor),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.workspace.read");
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) throw invalidRequest();
    const rooms = await getApplicationServices().locations.listRooms(
      id,
      authorizationActor(user),
    );
    return Response.json({ rooms });
  } catch (error) {
    return locationErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return post(request, (await params).id);
}
