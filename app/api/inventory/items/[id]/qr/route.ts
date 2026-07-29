import QRCode from "qrcode";

import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new ApplicationError("validation", "invalid_id");
    }
    const item = await getApplicationServices().items.findItem(
      id,
      authorizationActor(user),
    );
    if (!item.qrCode) {
      throw new ApplicationError("not_found", "item_qr_not_found");
    }
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "png" ? "png" : "svg";
    const download = url.searchParams.get("download") === "1";
    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="item-${id}-qr.${format}"`,
      "x-content-type-options": "nosniff",
    });
    if (format === "png") {
      const png = await QRCode.toBuffer(item.qrCode, {
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8,
        type: "png",
      });
      headers.set("content-type", "image/png");
      return new Response(new Uint8Array(png), { headers });
    }
    const svg = await QRCode.toString(item.qrCode, {
      errorCorrectionLevel: "M",
      margin: 2,
      type: "svg",
      width: 512,
    });
    headers.set("content-type", "image/svg+xml; charset=utf-8");
    return new Response(svg, { headers });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "qr_image_unavailable" }, { status: 503 });
  }
}
