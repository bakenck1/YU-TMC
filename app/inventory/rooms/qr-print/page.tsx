import { notFound } from "next/navigation";
import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";

export const dynamic = "force-dynamic";

export default async function RoomQrPrintPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[]; all?: string }> }) {
  const user = await requireAuthorizedPage("/inventory");
  if (!hasPermission(user.role, "inventory.qr.print_room")) notFound();
  const { ids: rawIds, all } = await searchParams;
  const ids = new Set(Array.isArray(rawIds) ? rawIds : rawIds?.split(",") ?? []);
  const printAll = all === "1";
  if (!printAll && !ids.size) notFound();
  const actor = authorizationActor(user);
  const buildings = (
    await getApplicationServices().locations.listBuildings(actor)
  ).filter((building) => isInventoryBuildingName(building.name));
  const rooms = (await Promise.all(buildings.map((building) => getApplicationServices().locations.listRooms(building.id, actor)))).flat().filter((room) => printAll || ids.has(room.id));
  if (!rooms.length) notFound();
  return <RoomQrBatchPrintView rooms={rooms} buildings={buildings} />;
}
