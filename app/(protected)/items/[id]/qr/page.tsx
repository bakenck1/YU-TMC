import { notFound } from "next/navigation";

import InventoryQrPrintView from "@/components/InventoryQrPrintView";
import { isUuid } from "@/lib/domain/identifiers";
import { toInventoryQrPrintItem } from "@/lib/inventory-qr-print";
import { hasPermission } from "@/lib/security/permissions";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

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
  if (!isUuid(id)) notFound();
  const kind = kindInput === "qr" ? "qr" : "barcode";
  const canManageQr = hasPermission(user.role, "inventory.qr.manage");
  if (kind === "qr" && !canManageQr) notFound();
  const actor = authorizationActor(user);
  const item = await readHiddenPageResource(
    () => getApplicationServices().items.findItem(id, actor),
    notFound,
  );
  if (kind === "qr" && !item.qrCode) notFound();
  return (
    <InventoryQrPrintView
      item={toInventoryQrPrintItem(item, kind)}
      kind={kind}
      canShowQr={canManageQr}
    />
  );
}
