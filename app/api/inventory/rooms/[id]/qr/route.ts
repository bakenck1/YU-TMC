import QRCode from "qrcode";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requirePermission,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission(request, "inventory.qr.manage");
    const { id } = await params;
    if (!isUuid(id)) throw invalidRequest();
    const url = new URL(request.url);
    const room = await getApplicationServices().locations.findRoom(
      id,
      authorizationActor(user),
    );
    const publicUrl = `${url.origin}/rooms/qr/${encodeURIComponent(room.qrCode)}`;
    const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
    const download = url.searchParams.get("download") === "1";
    if (format === "svg") {
      const svg = await QRCode.toString(publicUrl, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 768 });
      return new Response(svg, { headers: headers("image/svg+xml", download, id, "svg") });
    }
    const png = await QRCode.toBuffer(publicUrl, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 1024 });
    return new Response(new Uint8Array(png), { headers: headers("image/png", download, id, "png") });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "room_qr_unavailable" }, { status: 503 });
  }
}

function headers(type: string, download: boolean, id: string, extension: string) {
  const result: Record<string, string> = {
    "content-type": type,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (download) result["content-disposition"] = `attachment; filename="room-${id}-qr.${extension}"`;
  return result;
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}
