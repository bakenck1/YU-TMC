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
  searchParams: Promise<{ copies?: string }>;
}) {
  const { id } = await params;
  const { copies: copiesInput } = await searchParams;
  const user = await requireAuthorizedPage(`/items/${id}`);
  const item = await getApplicationServices().items.findItem(id, {
    userId: user.userId,
    role: user.role,
  });
  const copies = Math.max(1, Math.min(100, Number.parseInt(copiesInput ?? "1", 10) || 1));
  return <InventoryQrPrintView item={item} copies={copies} />;
}
