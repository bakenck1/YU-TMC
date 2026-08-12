import type { ChartDatum } from "@/lib/analytics-dashboard";

export type AnalyticsChartTone = "green" | "sky" | "violet" | "amber" | "rose" | "cyan" | "lime" | "ochre" | "neutral";

export interface AnalyticsChartSelection {
  title: string;
  segment: ChartDatum;
  tone: AnalyticsChartTone;
  valueKind: "count" | "money";
}
