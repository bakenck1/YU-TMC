import DecommissionedItemsView from "@/components/DecommissionedItemsView";
import DecommissionedRegistryTabs from "@/components/DecommissionedRegistryTabs";
import OneCDecommissionedAssetsView from "@/components/OneCDecommissionedAssetsView";
import Wrapper from "@/components/Wrapper";
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
      <Wrapper direction="column" gap="md">
        <DecommissionedRegistryTabs active="one-c" inventoryTotal={null} oneCTotal={result.total} />
        <OneCDecommissionedAssetsView result={result} search={search} />
      </Wrapper>
    );
  }

  const [items, oneCPreview] = await Promise.all([
    services.items.listDecommissionedItems(authorizationActor(user)),
    canManageOneC
      ? services.oneCReconciliation.listDecommissionedAssets({ page: 1, pageSize: 1 })
      : Promise.resolve(null),
  ]);
  return (
    <Wrapper direction="column" gap="md">
      <DecommissionedRegistryTabs active="inventory" inventoryTotal={items.length} oneCTotal={oneCPreview?.total ?? null} />
      <DecommissionedItemsView
        items={items.map(toDecommissionedInventoryItemView)}
        canExport={hasPermission(user.role, "inventory.report.export")}
      />
    </Wrapper>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
