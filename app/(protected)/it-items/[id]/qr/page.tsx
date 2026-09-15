import { notFound, redirect } from "next/navigation";

import InventoryQrPrintView from "@/components/InventoryQrPrintView";
import { isUuid } from "@/lib/domain/identifiers";
import { toInventoryQrPrintItem } from "@/lib/inventory-qr-print";
import { hasPermission } from "@/lib/security/permissions";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthenticatedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ItItemQrPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuthenticatedPage();
  if (user.role !== "admin") redirect("/access-denied");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const kind = "qr" as const;
  const canManageQr = hasPermission(user.role, "inventory.qr.manage");
  if (!canManageQr) notFound();
  const item = await readHiddenPageResource(
    () => getApplicationServices().items.findItem(id, authorizationActor(user)),
    notFound,
  );
  if (item.itemSection !== "it" || !item.qrCode) notFound();
  return (
    <InventoryQrPrintView
      item={toInventoryQrPrintItem(item, kind)}
      kind={kind}
      canShowQr={canManageQr}
      basePath="/it-items"
      allowBarcode={false}
      showInventoryNumber={false}
    />
  );
}
