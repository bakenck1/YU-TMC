import Link from "next/link";

import DecommissionedItemsView from "@/components/DecommissionedItemsView";
import OneCDecommissionedAssetsView from "@/components/OneCDecommissionedAssetsView";
import { toDecommissionedInventoryItemView } from "@/lib/inventory-item-view";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";
import { hasPermission } from "@/lib/security/permissions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DecommissionedItemsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAuthorizedPage("/items/decommissioned");
  const params = await searchParams;
  const canManageOneC = hasPermission(user.role, "inventory.integration.one_c.manage");
  const source = firstValue(params.source);
  const services = getApplicationServices();

  if (source === "one-c" && canManageOneC) {
    const page = positiveInteger(firstValue(params.page));
    const search = (firstValue(params.q) ?? "").normalize("NFKC").trim().slice(0, 100);
    const result = await services.oneCReconciliation.listDecommissionedAssets({ page, pageSize: 50, search });
    return (
      <div className="space-y-4">
        <RegistryTabs active="one-c" inventoryTotal={null} oneCTotal={result.total} />
        <OneCDecommissionedAssetsView result={result} search={search} />
      </div>
    );
  }

  const [items, oneCPreview] = await Promise.all([
    services.items.listDecommissionedItems(authorizationActor(user)),
    canManageOneC
      ? services.oneCReconciliation.listDecommissionedAssets({ page: 1, pageSize: 1 })
      : Promise.resolve(null),
  ]);
  return (
    <div className="space-y-4">
      <RegistryTabs active="inventory" inventoryTotal={items.length} oneCTotal={oneCPreview?.total ?? null} />
      <DecommissionedItemsView
        items={items.map(toDecommissionedInventoryItemView)}
        canExport={hasPermission(user.role, "inventory.report.export")}
      />
    </div>
  );
}

function RegistryTabs({
  active,
  inventoryTotal,
  oneCTotal,
}: {
  active: "inventory" | "one-c";
  inventoryTotal: number | null;
  oneCTotal: number | null;
}) {
  const tabClass = (selected: boolean) => selected
    ? "rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
    : "rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100";
  return (
    <nav aria-label="Источники списанных ОС" className="flex flex-wrap gap-2 rounded-2xl border border-black/5 bg-white p-2 shadow-sm">
      <Link className={tabClass(active === "inventory")} href="/items/decommissioned">
        Списанные в Inventory{inventoryTotal === null ? "" : ` (${inventoryTotal.toLocaleString("ru-RU")})`}
      </Link>
      {oneCTotal !== null && (
        <Link className={tabClass(active === "one-c")} href="/items/decommissioned?source=one-c">
          Списанные по данным 1С ({oneCTotal.toLocaleString("ru-RU")})
        </Link>
      )}
    </nav>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
