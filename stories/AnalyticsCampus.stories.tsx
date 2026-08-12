import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Boxes } from "lucide-react";

import AnalyticsChartCard from "@/components/AnalyticsChartCard";
import AnalyticsCharts from "@/components/AnalyticsCharts";
import AnalyticsDetailMetric from "@/components/AnalyticsDetailMetric";
import AnalyticsDetailsDialog from "@/components/AnalyticsDetailsDialog";
import AnalyticsDetailTable from "@/components/AnalyticsDetailTable";
import AnalyticsDonutChart from "@/components/AnalyticsDonutChart";
import AnalyticsPercentRing from "@/components/AnalyticsPercentRing";
import AnalyticsSummaryCard from "@/components/AnalyticsSummaryCard";
import CampusItemCard from "@/components/CampusItemCard";
import CampusItemStatusBadge from "@/components/CampusItemStatusBadge";
import CampusMap from "@/components/CampusMap";
import Wrapper from "@/components/Wrapper";
import { campusBuildings, campusItemsById, campusTotals } from "@/lib/campus";
import type { AnalyticsDashboardData, AnalyticsRecord, ChartDatum } from "@/lib/analytics-dashboard";

const record: AnalyticsRecord = {
  id: "asset-1",
  name: "Моноблок HP",
  qrCode: "YUQ1:asset-1",
  itemType: "Компьютер",
  brandModel: "HP ProOne 440",
  location: "Главный корпус · 201",
  building: "Главный корпус",
  responsible: "Demo User 1",
  quantity: 1,
  price: 420000,
  createdAt: "2026-08-01T10:00:00.000Z",
  status: "Активен",
  hasPhoto: true,
};

const chartDatum: ChartDatum = { name: "Компьютеры", value: 1, records: [record] };
const analyticsData: AnalyticsDashboardData = {
  records: [record],
  summary: { totalItems: 1, targetItems: 10, totalValue: 420000, assigned: 1, withPhoto: 1, completion: 10 },
  types: [chartDatum],
  brands: [{ ...chartDatum, name: "HP" }],
  objects: [{ ...chartDatum, name: "Главный корпус" }],
  locations: [{ ...chartDatum, name: "201" }],
  statuses: [{ ...chartDatum, name: "Активен" }],
  valueByType: [{ ...chartDatum, value: 420000 }],
  responsibles: [{ ...chartDatum, name: "Demo User 1" }],
};
const campusItem = Object.values(campusItemsById)[0]!;
const campusMapData = {
  buildings: campusBuildings,
  itemsById: campusItemsById,
  totals: {
    units: campusTotals.units,
    attention: campusTotals.attn,
    locations: campusTotals.locations,
  },
};

const meta = {
  title: "Catalog/Analytics and Campus",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnalyticsChartCardStory: Story = {
  name: "AnalyticsChartCard",
  render: () => <AnalyticsChartCard title="Распределение" subtitle="По категориям"><p>Содержимое графика</p></AnalyticsChartCard>,
};
export const AnalyticsDetailMetricStory: Story = {
  name: "AnalyticsDetailMetric",
  render: () => <AnalyticsDetailMetric icon={Boxes} label="Количество" value="128" />,
};
export const AnalyticsPercentRingStory: Story = {
  name: "AnalyticsPercentRing",
  parameters: { backgrounds: { default: "dark" } },
  render: () => <AnalyticsPercentRing value={64.2} />,
};
export const AnalyticsSummaryCardStory: Story = {
  name: "AnalyticsSummaryCard",
  render: () => <AnalyticsSummaryCard label="Все ТМЦ" value="1 248" hint="из 2 000" progress={62.4} icon={Boxes} />,
};
export const AnalyticsDonutChartStory: Story = {
  name: "AnalyticsDonutChart",
  render: () => <AnalyticsDonutChart data={[chartDatum, { ...chartDatum, name: "Мебель", value: 2 }]} title="Категории" onSelect={() => undefined} />,
};
export const AnalyticsDetailTableStory: Story = {
  name: "AnalyticsDetailTable",
  render: () => <AnalyticsDetailTable records={[record]} />,
};
export const AnalyticsDetailsDialogStory: Story = {
  name: "AnalyticsDetailsDialog",
  render: () => <AnalyticsDetailsDialog selection={{ title: "Категории", segment: chartDatum, tone: "green", valueKind: "count" }} onClose={() => undefined} />,
};
export const AnalyticsChartsStory: Story = {
  name: "AnalyticsCharts",
  render: () => <AnalyticsCharts data={analyticsData} />,
};
export const CampusItemStatusBadgeStory: Story = {
  name: "CampusItemStatusBadge",
  render: () => <Wrapper gap="sm" padding="lg"><CampusItemStatusBadge status="ok" /><CampusItemStatusBadge status="check" /><CampusItemStatusBadge status="service" /></Wrapper>,
};
export const CampusItemCardStory: Story = {
  name: "CampusItemCard",
  render: () => <CampusItemCard item={campusItem} buildingName="Главный корпус" />,
};
export const CampusMapStory: Story = {
  name: "CampusMap",
  render: () => <CampusMap data={campusMapData} />,
};
