"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Boxes,
  Camera,
  UserCheck,
} from "lucide-react";
import {
  Cell,
  Label,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface ChartDatum {
  name: string;
  value: number;
}

export interface AnalyticsDashboardData {
  summary: {
    totalItems: number;
    targetItems: number;
    totalValue: number;
    assigned: number;
    withPhoto: number;
    completion: number;
  };
  types: ChartDatum[];
  brands: ChartDatum[];
  objects: ChartDatum[];
  locations: ChartDatum[];
  statuses: ChartDatum[];
  valueByType: ChartDatum[];
  responsibles: ChartDatum[];
}

const CHART_COLORS = [
  "#16a34a",
  "#0ea5e9",
  "#7c3aed",
  "#f59e0b",
  "#e11d48",
  "#0891b2",
  "#65a30d",
  "#a16207",
];

const STATUS_COLORS: Record<string, string> = {
  Работник: "#7c3aed",
  Маркировано: "#16a34a",
  "Не распределено": "#a1a1aa",
  Активен: "#0ea5e9",
  "На обслуживании": "#f59e0b",
  Списано: "#e11d48",
};

const numberFormatter = new Intl.NumberFormat("ru-RU");
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
const compactMoneyFormatter = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatMoney(value: number) {
  return `${moneyFormatter.format(value)} ₸`;
}

function formatCenterValue(value: number, valueKind: "count" | "money") {
  if (valueKind === "money") return `${compactMoneyFormatter.format(value)} ₸`;
  return numberFormatter.format(value);
}

function PercentRing({ value }: { value: number }) {
  const safeValue = Math.min(100, Math.max(0, value));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (safeValue / 100) * circumference;

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 96 96" className="-rotate-90" aria-hidden="true">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="#586477" strokeWidth="7" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke="#34d399"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white">
        {safeValue.toFixed(1)}%
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  progress,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  progress: number;
  icon: typeof Boxes;
}) {
  const safeProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="flex flex-col items-center rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm">
      <div
        className="relative flex h-32 w-32 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(#16a34a ${safeProgress * 3.6}deg, #e4e4e7 0deg)`,
        }}
      >
        <div className="flex h-[104px] w-[104px] flex-col items-center justify-center rounded-full bg-white">
          <Icon className="mb-1 h-5 w-5 text-emerald-600" />
          <strong className="text-xl tracking-tight text-zinc-900">{value}</strong>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-zinc-800">{label}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-black/5 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4">
        <h2 className="font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function DonutChart({
  data,
  statusColors = false,
  valueKind = "count",
}: {
  data: ChartDatum[];
  statusColors?: boolean;
  valueKind?: "count" | "money";
}) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="36%"
            cy="50%"
            innerRadius={88}
            outerRadius={126}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={
                  statusColors
                    ? STATUS_COLORS[entry.name] ?? CHART_COLORS[index % CHART_COLORS.length]
                    : CHART_COLORS[index % CHART_COLORS.length]
                }
              />
            ))}
            <Label
              value={formatCenterValue(total, valueKind)}
              position="center"
              dy={-7}
              fill="#18181b"
              fontSize={28}
              fontWeight={700}
            />
            <Label
              value={valueKind === "money" ? "общая стоимость" : "единиц"}
              position="center"
              dy={19}
              fill="#a1a1aa"
              fontSize={12}
            />
          </Pie>
          <Tooltip
            formatter={(value) => [
              valueKind === "money"
                ? formatMoney(Number(value))
                : `${numberFormatter.format(Number(value))} ед.`,
              valueKind === "money" ? "Стоимость" : "Количество",
            ]}
            contentStyle={{ borderRadius: 12, borderColor: "#e4e4e7", fontSize: 12 }}
          />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            formatter={(value) => <span className="text-xs text-zinc-600">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AnalyticsCharts({ data }: { data: AnalyticsDashboardData }) {
  const assignedPercent = data.summary.totalItems
    ? (data.summary.assigned / data.summary.totalItems) * 100
    : 0;
  const photoPercent = data.summary.totalItems
    ? (data.summary.withPhoto / data.summary.totalItems) * 100
    : 0;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-slate-700 p-6 text-white shadow-lg md:p-8">
        <div className="absolute -bottom-20 right-32 h-52 w-52 rounded-full bg-slate-600/70" />
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[28px] border-emerald-400/10" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Banknote className="h-6 w-6 text-emerald-300" />
            </span>
            <div>
              <p className="text-sm text-slate-300">Общая стоимость учтённых ТМЦ</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                {formatMoney(data.summary.totalValue)}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                Аналитика рассчитана по {numberFormatter.format(data.summary.totalItems)} внесённым записям.
                Данные обновляются автоматически вместе со списком ТМЦ.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <PercentRing value={data.summary.completion} />
            <div>
              <p className="text-sm font-medium">Заполнение базы</p>
              <p className="mt-1 text-xs text-slate-300">
                {data.summary.totalItems} из {data.summary.targetItems} записей
              </p>
              <Link
                href="/items"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-400/50 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/10"
              >
                Посмотреть ТМЦ <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Всего ТМЦ"
          value={numberFormatter.format(data.summary.totalItems)}
          hint={`Плановая база: ${numberFormatter.format(data.summary.targetItems)}`}
          progress={data.summary.completion}
          icon={Boxes}
        />
        <SummaryCard
          label="Назначен ответственный"
          value={`${assignedPercent.toFixed(1)}%`}
          hint={`${data.summary.assigned} заполненных записей`}
          progress={assignedPercent}
          icon={UserCheck}
        />
        <SummaryCard
          label="Есть фотография"
          value={`${photoPercent.toFixed(1)}%`}
          hint={`${data.summary.withPhoto} фотографий в базе`}
          progress={photoPercent}
          icon={Camera}
        />
        <SummaryCard
          label="Распределено по объектам"
          value={numberFormatter.format(data.objects.length)}
          hint={`${data.locations.length} локаций в базе`}
          progress={Math.min(100, data.objects.length * 20)}
          icon={Boxes}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Бренды" subtitle="Распределение оборудования по производителям">
          <DonutChart data={data.brands} />
        </ChartCard>
        <ChartCard title="Типы ТМЦ" subtitle="Структура оборудования в текущей базе">
          <DonutChart data={data.types} />
        </ChartCard>
        <ChartCard title="Статусы" subtitle="Текущее состояние и распределение ТМЦ">
          <DonutChart data={data.statuses} statusColors />
        </ChartCard>
        <ChartCard title="Локации" subtitle="Локации с наибольшим количеством оборудования">
          <DonutChart data={data.locations} />
        </ChartCard>
        <ChartCard
          title="Стоимость по типам"
          subtitle="Распределение известной стоимости оборудования"
        >
          <DonutChart data={data.valueByType} valueKind="money" />
        </ChartCard>
        <ChartCard title="Ответственные" subtitle="Сотрудники с наибольшим количеством ТМЦ">
          <DonutChart data={data.responsibles} />
        </ChartCard>
        <ChartCard title="Объекты" subtitle="Количество учтённого оборудования по объектам">
          <DonutChart data={data.objects} />
        </ChartCard>
      </div>
    </div>
  );
}
