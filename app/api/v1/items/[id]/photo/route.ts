import { authorizeDockflowRequest } from "@/lib/dockflow-api";
import { getDatabasePool } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = authorizeDockflowRequest(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "ITEM_NOT_FOUND", message: "ТМЦ не найдено." }, { status: 404 });
  }

  const result = await getDatabasePool().query<{ binary_data: Uint8Array; trusted_mime_type: string }>(
    `select p.binary_data, p.trusted_mime_type
       from "yu_inventory"."photos" p
       join "yu_inventory"."items" i on i.id = p.item_id
      where p.item_id = $1 and p.purpose = 'item' and p.status = 'attached'
        and p.binary_data is not null and p.trusted_mime_type in ('image/jpeg', 'image/png', 'image/webp')
        and i.archived_at is null and i.status <> 'decommissioned'
      order by p.attached_at desc nulls last limit 1`,
    [id],
  );
  const photo = result.rows[0];
  if (!photo) {
    return Response.json({ error: "ITEM_PHOTO_NOT_FOUND", message: "Фото ТМЦ не найдено." }, { status: 404 });
  }

  return new Response(photo.binary_data as unknown as BodyInit, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      "Content-Type": photo.trusted_mime_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
