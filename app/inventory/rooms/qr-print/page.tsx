import { notFound } from "next/navigation";
import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const dynamic = "force-dynamic";

export default async function RoomQrPrintPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const user = await requireAuthorizedPage("/inventory");
  if (user.role !== "admin") notFound();
  const rawIds = (await searchParams).ids;
  const ids = new Set((Array.isArray(rawIds) ? rawIds : rawIds?.split(",") ?? []).slice(0, 100));
  if (!ids.size) notFound();
  const actor = authorizationActor(user);
  const buildings = (
    await getApplicationServices().locations.listBuildings(actor)
  ).filter((building) => isInventoryBuildingName(building.name));
  const rooms = (await Promise.all(buildings.map((building) => getApplicationServices().locations.listRooms(building.id, actor)))).flat().filter((room) => ids.has(room.id));
  if (!rooms.length) notFound();
  return <RoomQrBatchPrintView rooms={rooms} />;
}
