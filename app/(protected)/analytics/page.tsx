// Authentication for this route group is enforced by the adjacent layout.
import AnalyticsCharts from "@/components/AnalyticsCharts";
import type {
  AnalyticsDashboardData,
  AnalyticsRecord,
  ChartDatum,
} from "@/lib/analytics-dashboard";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import { getApplicationServices } from "@/lib/server/application";
import { activeInventoryItems } from "@/lib/server/excel/inventory-excel";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

const INVENTORY_TARGET = 2_000;

function toAnalyticsRecord(item: InventoryItemDto): AnalyticsRecord {
  return {
    id: item.id,
    name: item.name,
    qrCode: item.qrCode ?? item.inventoryNumber,
    itemType: item.itemType,
    brandModel: [item.brand, item.model].filter(Boolean).join(" "),
    location: `${item.room.buildingName} / ${item.room.designation}`,
    building: item.room.buildingName,
    responsible: item.responsible?.name ?? "-",
    quantity: item.quantity,
    price: item.unitPrice * item.quantity,
    createdAt: item.createdAt,
    status: item.status,
    hasPhoto: item.photoUrl !== null,
  };
}

function countBy(
  source: InventoryItemDto[],
  selector: (item: InventoryItemDto) => string,
): ChartDatum[] {
  const counts = new Map<string, ChartDatum>();
  source.forEach((item) => {
    const name = selector(item).trim() || "Не указано";
    const current = counts.get(name);
    if (current) {
      current.value += item.quantity;
      current.records.push(toAnalyticsRecord(item));
    } else {
      counts.set(name, {
        name,
        value: item.quantity,
        records: [toAnalyticsRecord(item)],
      });
    }
  });
  return Array.from(counts.values()).sort((left, right) => right.value - left.value);
}

function topWithOther(data: ChartDatum[], limit = 7): ChartDatum[] {
  if (data.length <= limit) return data;
  const top = data.slice(0, limit);
  const remainder = data.slice(limit);
  return [
    ...top,
    {
      name: "Остальные",
      value: remainder.reduce((sum, entry) => sum + entry.value, 0),
      records: remainder.flatMap((entry) => entry.records),
    },
  ];
}

function valueByType(items: InventoryItemDto[]): ChartDatum[] {
  const totals = new Map<string, ChartDatum>();
  items.forEach((item) => {
    const name = item.itemType.trim() || "Без типа";
    const value = item.unitPrice * item.quantity;
    const current = totals.get(name);
    if (current) {
      current.value += value;
      current.records.push(toAnalyticsRecord(item));
    } else {
      totals.set(name, { name, value, records: [toAnalyticsRecord(item)] });
    }
  });
  return Array.from(totals.values())
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);
}

function statusName(item: InventoryItemDto) {
  if (item.status === "maintenance") return "На обслуживании";
  if (item.status === "decommissioned") return "Списано";
  return "Активен";
}

export default async function AnalyticsPage() {
  const user = await requireAuthorizedPage("/analytics");
  const items = activeInventoryItems(await getApplicationServices().items.listItems(
    authorizationActor(user),
  ));
  const totalValue = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const assigned = items.filter((item) => item.responsible !== null).length;
  const withPhoto = items.filter((item) => item.photoUrl !== null).length;

  const data: AnalyticsDashboardData = {
    records: items.map(toAnalyticsRecord),
    summary: {
      totalItems: items.length,
      targetItems: INVENTORY_TARGET,
      totalValue,
      assigned,
      withPhoto,
      completion: (items.length / INVENTORY_TARGET) * 100,
    },
    types: topWithOther(countBy(items, (item) => item.itemType)),
    brands: topWithOther(countBy(items, (item) => item.brand ?? "Без бренда")),
    objects: countBy(items, (item) => item.room.buildingName),
    locations: topWithOther(countBy(items, (item) => item.room.designation), 8),
    statuses: countBy(items, statusName),
    valueByType: valueByType(items),
    responsibles: topWithOther(
      countBy(
        items.filter((item) => item.responsible !== null),
        (item) => item.responsible?.name ?? "-",
      ),
      6,
    ),
  };

  return <AnalyticsCharts data={data} />;
}
