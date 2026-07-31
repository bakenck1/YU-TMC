import QRCode from "qrcode";

import { ApplicationError } from "@/lib/domain/application-error";
import {
  code39PayloadForItem,
  renderCode39Svg,
} from "@/lib/domain/code39";
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
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") === "qr" ? "qr" : "barcode";
    if (kind === "qr" && !item.qrCode) {
      throw new ApplicationError("not_found", "item_qr_not_found");
    }
    const requestedFormat =
      url.searchParams.get("format") === "png" ? "png" : "svg";
    const format = kind === "qr" ? requestedFormat : "svg";
    const download = url.searchParams.get("download") === "1";
    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="item-${id}-${kind === "qr" ? "qr" : "code39"}.${format}"`,
      "x-content-type-options": "nosniff",
    });
    if (kind === "barcode") {
      const payload = code39PayloadForItem(item.inventoryNumber, item.id);
      const svg = renderCode39Svg(payload);
      headers.set("content-type", "image/svg+xml; charset=utf-8");
      return new Response(svg, { headers });
    }
    if (format === "png") {
      const png = await QRCode.toBuffer(item.qrCode!, {
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8,
        type: "png",
      });
      headers.set("content-type", "image/png");
      return new Response(new Uint8Array(png), { headers });
    }
    const svg = await QRCode.toString(item.qrCode!, {
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
