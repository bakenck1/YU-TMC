import { notFound } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import RoomQrBatchPrintView from "@/components/RoomQrBatchPrintView";
import { isInventoryBuildingName } from "@/lib/campus-directory";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";
import { configuredPublicOrigin } from "@/lib/security/public-origin";

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
  const origin = configuredPublicOrigin() ?? new URL(`http://${(await headers()).get("host") ?? "localhost:3000"}`).origin;
  // Embed the authorized labels in one response: eager image API requests exceed
  // the shared request budget on large print sheets.
  const qrImages = Object.fromEntries(await Promise.all(rooms.map(async (room) => {
    const publicUrl = `${origin}/rooms/qr/${encodeURIComponent(room.qrCode)}`;
    const svg = await QRCode.toString(publicUrl, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 768 });
    return [room.id, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`];
  })));
  return <RoomQrBatchPrintView rooms={rooms} buildings={buildings} qrImages={qrImages} />;
}
