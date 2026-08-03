export interface ChartDatum {
  name: string;
  value: number;
  records: AnalyticsRecord[];
}

export interface AnalyticsRecord {
  id: string;
  name: string;
  qrCode: string;
  itemType: string;
  brandModel: string;
  location: string;
  building: string;
  responsible: string;
  quantity: number;
  price: number;
  createdAt: string;
  status: string;
  hasPhoto: boolean;
}

export interface AnalyticsDashboardData {
  records: AnalyticsRecord[];
  summary: { totalItems: number; targetItems: number; totalValue: number; assigned: number; withPhoto: number; completion: number };
  types: ChartDatum[];
  brands: ChartDatum[];
  objects: ChartDatum[];
  locations: ChartDatum[];
  statuses: ChartDatum[];
  valueByType: ChartDatum[];
  responsibles: ChartDatum[];
}

export function filteredDashboard(initial: AnalyticsDashboardData, filters: { building: string; itemType: string; dateFrom: string; dateTo: string }): AnalyticsDashboardData {
  const records = initial.records.filter((record) =>
    (filters.building === "all" || record.building === filters.building) &&
    (filters.itemType === "all" || record.itemType === filters.itemType) &&
    (!filters.dateFrom || record.createdAt.slice(0, 10) >= filters.dateFrom) &&
    (!filters.dateTo || record.createdAt.slice(0, 10) <= filters.dateTo));
  const group = (selector: (record: AnalyticsRecord) => string, value: (record: AnalyticsRecord) => number = (record) => record.quantity): ChartDatum[] => {
    const grouped = new Map<string, ChartDatum>();
    records.forEach((record) => {
      const name = selector(record) || "-";
      const current = grouped.get(name);
      if (current) { current.value += value(record); current.records.push(record); }
      else grouped.set(name, { name, value: value(record), records: [record] });
    });
    return Array.from(grouped.values()).sort((a, b) => b.value - a.value);
  };
  return {
    records,
    summary: { ...initial.summary, totalItems: records.length, totalValue: records.reduce((sum, record) => sum + record.price, 0), assigned: records.filter((record) => record.responsible !== "-").length, withPhoto: records.filter((record) => record.hasPhoto).length, completion: (records.length / initial.summary.targetItems) * 100 },
    types: group((record) => record.itemType),
    brands: group((record) => record.brandModel || "-"),
    objects: group((record) => record.building),
    locations: group((record) => record.location),
    statuses: group((record) => record.status),
    valueByType: group((record) => record.itemType, (record) => record.price),
    responsibles: group((record) => record.responsible),
  };
}
