import AnalyticsCharts, {
  type AnalyticsDashboardData,
  type ChartDatum,
} from "@/components/AnalyticsCharts";
import { items } from "@/lib/data";
import type { InventoryItem } from "@/lib/types";

const INVENTORY_TARGET = 1140;

function countBy(
  source: InventoryItem[],
  selector: (item: InventoryItem) => string,
): ChartDatum[] {
  const counts = new Map<string, number>();

  source.forEach((item) => {
    const name = selector(item).trim() || "Не указано";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });

  return Array.from(counts, ([name, value]) => ({ name, value })).sort(
    (a, b) => b.value - a.value,
  );
}

function topWithOther(data: ChartDatum[], limit = 7): ChartDatum[] {
  if (data.length <= limit) return data;

  const top = data.slice(0, limit);
  const other = data.slice(limit).reduce((sum, entry) => sum + entry.value, 0);
  return [...top, { name: "Остальные", value: other }];
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
  const totals = new Map<string, number>();

  items.forEach((item) => {
    const type = item.itemType?.trim() || "Без типа";
    totals.set(type, (totals.get(type) ?? 0) + (item.price ?? 0));
  });

  return Array.from(totals, ([name, value]) => ({ name, value }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

export default function AnalyticsPage() {
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
        items.filter((item) => item.responsible.trim()),
        (item) => item.responsible,
      ),
      6,
    ),
  };

  return <AnalyticsCharts data={data} />;
}
