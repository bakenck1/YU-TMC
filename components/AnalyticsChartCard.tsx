import type { ReactNode } from "react";

interface AnalyticsChartCardProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export default function AnalyticsChartCard({ title, subtitle, children }: AnalyticsChartCardProps) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
