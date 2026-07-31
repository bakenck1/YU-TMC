import InventoryQrPrintView from "@/components/InventoryQrPrintView";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ItemQrPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { id } = await params;
  const { kind: kindInput } = await searchParams;
  const user = await requireAuthorizedPage(`/items/${id}`);
  const item = await getApplicationServices().items.findItem(id, {
    userId: user.userId,
    role: user.role,
  });
  const kind = kindInput === "qr" ? "qr" : "barcode";
  return <InventoryQrPrintView item={item} kind={kind} />;
}
