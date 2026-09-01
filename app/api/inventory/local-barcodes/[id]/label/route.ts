import { ApplicationError } from "@/lib/domain/application-error";
import { renderCode39Svg } from "@/lib/domain/code39";
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
    const group = await getApplicationServices().localBarcodes.getGroup(
      id,
      authorizationActor(user),
    );
    const svg = renderCode39Svg(group.localBarcode, {
      heading: "YESSENOV UNIVERSITY",
    });
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(svg, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "image/svg+xml; charset=utf-8",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="local-barcode-${group.id}.svg"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json(
          { error: "local_barcode_label_unavailable" },
          { status: 503 },
        );
  }
}
