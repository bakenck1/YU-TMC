// Authentication for this route group is enforced by the adjacent layout.
import AnalyticsCharts, {
  type AnalyticsDashboardData,
  type ChartDatum,
  type AnalyticsRecord,
} from "@/components/AnalyticsCharts";
import { items } from "@/lib/data";
import type { InventoryItem } from "@/lib/types";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

const INVENTORY_TARGET = 1140;

function toAnalyticsRecord(item: InventoryItem): AnalyticsRecord {
  return {
    id: item.id,
    name: item.name,
    qrCode: item.qrCode ?? item.inventoryNumber ?? "",
    itemType: item.itemType ?? item.name,
    brandModel: item.brandModel ?? "",
    location: item.location,
    responsible: item.responsible,
    quantity: item.quantity ?? 1,
    price: item.price ?? 0,
  };
}

function countBy(
  source: InventoryItem[],
  selector: (item: InventoryItem) => string,
): ChartDatum[] {
  const counts = new Map<string, ChartDatum>();

  source.forEach((item) => {
    const name = selector(item).trim() || "Не указано";
    const current = counts.get(name);

    if (current) {
      current.value += item.quantity ?? 1;
      current.records.push(toAnalyticsRecord(item));
      return;
    }

    counts.set(name, {
      name,
      value: item.quantity ?? 1,
      records: [toAnalyticsRecord(item)],
    });
  });

  return Array.from(counts.values()).sort(
    (a, b) => b.value - a.value,
  );
}

function topWithOther(data: ChartDatum[], limit = 7): ChartDatum[] {
  if (data.length <= limit) return data;

  const top = data.slice(0, limit);
  const other = data.slice(limit).reduce((sum, entry) => sum + entry.value, 0);
  const otherRecords = data.slice(limit).flatMap((entry) => entry.records);
  return [...top, { name: "Остальные", value: other, records: otherRecords }];
}

function brandName(item: InventoryItem) {
  const brand = item.brandModel?.trim();
  if (!brand) return "Без бренда";

  const firstWord = brand.split(/[\s·]+/)[0];
  const aliases: Record<string, string> = {
    hp: "HP",
    lenovo: "Lenovo",
    samsung: "Samsung",
    epson: "Epson",
    acer: "Acer",
    grandstream: "GRANDSTREAM",
    optoma: "OPTOMA",
    proscreen: "PROscreen",
  };

  return aliases[firstWord.toLowerCase()] ?? firstWord;
}

function objectName(item: InventoryItem) {
  if (item.location.startsWith("32 мкр")) return "32 мкр";
  if (item.location.startsWith("11 мкр")) return "11 мкр";
  return item.location.split(" / ")[0];
}

function locationName(item: InventoryItem) {
  const parts = item.location.split(" / ");
  if (parts.length > 1) return parts.at(-1) ?? item.location;

  return item.location
    .replace(/^32 мкр\s*/i, "")
    .replace(/^11 мкр\s*/i, "") || item.location;
}

function statusName(item: InventoryItem) {
  if (item.displayStatus) return item.displayStatus;
  if (item.status === "maintenance") return "На обслуживании";
  if (item.status === "decommissioned") return "Списано";
  return "Активен";
}

function valueByType(): ChartDatum[] {
  const totals = new Map<string, ChartDatum>();

  items.forEach((item) => {
    const type = item.itemType?.trim() || "Без типа";
    const current = totals.get(type);

    if (current) {
      current.value += item.price ?? 0;
      current.records.push(toAnalyticsRecord(item));
      return;
    }

    totals.set(type, {
      name: type,
      value: item.price ?? 0,
      records: [toAnalyticsRecord(item)],
    });
  });

  return Array.from(totals.values())
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

export default async function AnalyticsPage() {
  await requireAuthorizedPage("/analytics");
  const totalValue = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const assigned = items.filter(
    (item) => item.responsible.trim() && item.responsible !== "-",
  ).length;
  const withPhoto = items.filter((item) => Boolean(item.photo)).length;

  const data: AnalyticsDashboardData = {
    summary: {
      totalItems: items.length,
      targetItems: INVENTORY_TARGET,
      totalValue,
      assigned,
      withPhoto,
      completion: (items.length / INVENTORY_TARGET) * 100,
    },
    types: topWithOther(countBy(items, (item) => item.itemType ?? "Без типа")),
    brands: topWithOther(countBy(items, brandName)),
    objects: countBy(items, objectName),
    locations: topWithOther(countBy(items, locationName), 8),
    statuses: countBy(items, statusName),
    valueByType: valueByType(),
    responsibles: topWithOther(
      countBy(
        items.filter(
          (item) => item.responsible.trim() && item.responsible !== "-",
        ),
        (item) => item.responsible,
      ),
      6,
    ),
  };

  return <AnalyticsCharts data={data} />;
}
