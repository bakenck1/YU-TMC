"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  Boxes,
  Camera,
  ExternalLink,
  FileSpreadsheet,
  PackageSearch,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import AnalyticsExcelTools from "@/components/AnalyticsExcelTools";
import { filteredDashboard, type AnalyticsDashboardData, type AnalyticsRecord, type ChartDatum } from "@/lib/analytics-dashboard";

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

function formatMoney(value: number, locale: string) {
  const moneyFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return `${moneyFormatter.format(value)} ₸`;
}

function shadeHex(hex: string, amount: number) {
  const cleanHex = hex.replace("#", "");
  const numericColor = Number.parseInt(cleanHex, 16);
  const red = Math.min(255, Math.max(0, (numericColor >> 16) + amount));
  const green = Math.min(255, Math.max(0, ((numericColor >> 8) & 0xff) + amount));
  const blue = Math.min(255, Math.max(0, (numericColor & 0xff) + amount));

  return `#${((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0")}`;
}

function chartColor(entry: ChartDatum, index: number, useStatusColors: boolean) {
  if (useStatusColors && STATUS_COLORS[entry.name]) return STATUS_COLORS[entry.name];
  return CHART_COLORS[index % CHART_COLORS.length];
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
  title,
  onSelect,
  centerTotal,
  statusColors = false,
  valueKind = "count",
}: {
  data: ChartDatum[];
  title: string;
  onSelect: (selection: ChartSelection) => void;
  centerTotal?: number;
  statusColors?: boolean;
  valueKind?: "count" | "money";
}) {
  const { dataLabel, locale, t } = useAppSettings();
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offsetsRef = useRef<number[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const colors = useMemo(
    () => data.map((entry, index) => chartColor(entry, index, statusColors)),
    [data, statusColors],
  );
  const totalValue = data.reduce((sum, entry) => sum + entry.value, 0);
  const totalUnits = useMemo(() => {
    const uniqueRecords = new Map<string, AnalyticsRecord>();

    data.forEach((entry) => {
      entry.records.forEach((record) => uniqueRecords.set(record.id, record));
    });

    return Array.from(uniqueRecords.values()).reduce(
      (sum, record) => sum + record.quantity,
      0,
    );
  }, [data]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(width, height) * 0.315;
    const innerRadius = outerRadius * 0.62;
    const verticalScale = 0.84;
    const depth = 17;
    const selectedDistance = 15;
    const startAngle = -Math.PI / 2;
    const fullCircle = Math.PI * 2;

    const drawSegment = (
      segmentStart: number,
      segmentEnd: number,
      yOffset: number,
      fillStyle: string | CanvasGradient,
      offsetX = 0,
      offsetY = 0,
    ) => {
      const seamOverlap = 0.0012;

      context.save();
      context.translate(centerX + offsetX, centerY + yOffset + offsetY);
      context.scale(1, verticalScale);
      context.beginPath();
      context.arc(
        0,
        0,
        outerRadius,
        segmentStart - seamOverlap,
        segmentEnd + seamOverlap,
      );
      context.arc(
        0,
        0,
        innerRadius,
        segmentEnd + seamOverlap,
        segmentStart - seamOverlap,
        true,
      );
      context.closePath();
      context.fillStyle = fillStyle;
      context.fill();
      context.restore();
    };

    context.save();
    context.translate(centerX, centerY + depth + 5);
    context.scale(1, verticalScale);
    context.beginPath();
    context.arc(0, 0, outerRadius * 0.96, 0, fullCircle);
    context.arc(0, 0, innerRadius, fullCircle, 0, true);
    context.closePath();
    context.shadowColor = "rgba(15, 23, 42, 0.34)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 10;
    context.fillStyle = "rgba(15, 23, 42, 0.16)";
    context.fill();
    context.restore();

    if (totalValue <= 0) return;

    for (let layer = depth; layer >= 1; layer -= 1) {
      let currentAngle = startAngle;

      data.forEach((entry, index) => {
        const nextAngle = currentAngle + (entry.value / totalValue) * fullCircle;
        const middleAngle = (currentAngle + nextAngle) / 2;
        const selectionOffset =
          (offsetsRef.current[index] ?? 0) * selectedDistance;
        const offsetX = Math.cos(middleAngle) * selectionOffset;
        const offsetY =
          Math.sin(middleAngle) * selectionOffset * verticalScale;
        drawSegment(
          currentAngle,
          nextAngle,
          layer,
          shadeHex(colors[index], -42 + Math.round(layer * 0.45)),
          offsetX,
          offsetY,
        );
        currentAngle = nextAngle;
      });
    }

    let currentAngle = startAngle;
    data.forEach((entry, index) => {
      const nextAngle = currentAngle + (entry.value / totalValue) * fullCircle;
      const middleAngle = (currentAngle + nextAngle) / 2;
      const selectionOffset =
        (offsetsRef.current[index] ?? 0) * selectedDistance;
      const offsetX = Math.cos(middleAngle) * selectionOffset;
      const offsetY =
        Math.sin(middleAngle) * selectionOffset * verticalScale;
      drawSegment(
        currentAngle,
        nextAngle,
        0,
        colors[index],
        offsetX,
        offsetY,
      );
      currentAngle = nextAngle;
    });

    const labels = data.map((entry, index) => {
      const entryStart = data
        .slice(0, index)
        .reduce(
          (angle, current) =>
            angle + (current.value / totalValue) * fullCircle,
          startAngle,
        );
      const entryEnd =
        entryStart + (entry.value / totalValue) * fullCircle;
      const middleAngle = (entryStart + entryEnd) / 2;
      const selectionOffset =
        (offsetsRef.current[index] ?? 0) * selectedDistance;
      const offsetX = Math.cos(middleAngle) * selectionOffset;
      const offsetY =
        Math.sin(middleAngle) * selectionOffset * verticalScale;

      return {
        entry,
        middleAngle,
        offsetX,
        offsetY,
        side: Math.cos(middleAngle) >= 0 ? "right" : "left",
        targetY:
          centerY +
          Math.sin(middleAngle) * (outerRadius + 28) * verticalScale +
          offsetY,
      };
    });

    (["left", "right"] as const).forEach((side) => {
      const sideLabels = labels
        .filter((label) => label.side === side)
        .sort((first, second) => first.targetY - second.targetY);
      const minimumY = 42;
      const maximumY = height - 42;
      const minimumGap = 23;

      sideLabels.forEach((label, index) => {
        const previousY =
          index === 0 ? minimumY - minimumGap : sideLabels[index - 1].targetY;
        label.targetY = Math.max(label.targetY, previousY + minimumGap);
      });

      for (let index = sideLabels.length - 1; index >= 0; index -= 1) {
        const nextY =
          index === sideLabels.length - 1
            ? maximumY + minimumGap
            : sideLabels[index + 1].targetY;
        sideLabels[index].targetY = Math.min(
          sideLabels[index].targetY,
          nextY - minimumGap,
        );
      }
    });

    const fontFamily =
      window.getComputedStyle(canvas).fontFamily || "Arial, sans-serif";
    context.font = `12px ${fontFamily}`;
    context.lineWidth = 1;
    context.strokeStyle = "#d1d5db";
    context.fillStyle = "#374151";

    labels.forEach((label) => {
      const direction = label.side === "right" ? 1 : -1;
      const startX =
        centerX +
        Math.cos(label.middleAngle) * (outerRadius + 2) +
        label.offsetX;
      const startY =
        centerY +
        Math.sin(label.middleAngle) * (outerRadius + 2) * verticalScale +
        label.offsetY;
      const elbowX = centerX + direction * (outerRadius + 24);
      const endX = centerX + direction * (outerRadius + 38);

      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(elbowX, label.targetY);
      context.lineTo(endX, label.targetY);
      context.stroke();

      const translatedName = dataLabel(label.entry.name);
      const shortenedName =
        translatedName.length > 13
          ? `${translatedName.slice(0, 12)}…`
          : translatedName;
      context.textAlign = label.side === "right" ? "left" : "right";
      context.textBaseline = "middle";
      context.fillText(
        shortenedName,
        endX + direction * 5,
        label.targetY,
      );
    });
  }, [colors, data, dataLabel, totalValue]);

  useEffect(() => {
    drawChart();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(drawChart);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [drawChart]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const initialOffsets = data.map(
      (_, index) => offsetsRef.current[index] ?? 0,
    );
    const targetOffsets = data.map((_, index) =>
      index === activeIndex ? 1 : 0,
    );
    const startedAt = performance.now();
    const duration = 320;

    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      offsetsRef.current = initialOffsets.map(
        (start, index) =>
          start + (targetOffsets[index] - start) * easedProgress,
      );
      drawChart();

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [activeIndex, data, drawChart]);

  const findSegment = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || totalValue <= 0) return -1;

      const bounds = canvas.getBoundingClientRect();
      const outerRadius = Math.min(bounds.width, bounds.height) * 0.315;
      const innerRadius = outerRadius * 0.62;
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const verticalScale = 0.84;
      const selectedDistance = 15;
      const fullCircle = Math.PI * 2;
      const startAngle = -Math.PI / 2;
      let segmentStart = startAngle;
      const segments = data.map((entry, index) => {
        const segmentEnd =
          segmentStart + (entry.value / totalValue) * fullCircle;
        const segment = { index, start: segmentStart, end: segmentEnd };
        segmentStart = segmentEnd;
        return segment;
      });
      const orderedSegments =
        activeIndex === null
          ? segments
          : [
              segments[activeIndex],
              ...segments.filter((segment) => segment.index !== activeIndex),
            ];

      for (const segment of orderedSegments) {
        const middleAngle = (segment.start + segment.end) / 2;
        const selectionOffset =
          (offsetsRef.current[segment.index] ?? 0) * selectedDistance;
        const shiftedCenterX =
          centerX + Math.cos(middleAngle) * selectionOffset;
        const shiftedCenterY =
          centerY +
          Math.sin(middleAngle) * selectionOffset * verticalScale;
        const deltaX = pointerX - shiftedCenterX;
        const deltaY = (pointerY - shiftedCenterY) / verticalScale;
        const radius = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (radius < innerRadius || radius > outerRadius) continue;

        const pointerAngle = Math.atan2(deltaY, deltaX);
        const normalizedPointer =
          (pointerAngle - startAngle + fullCircle) % fullCircle;
        const normalizedStart =
          (segment.start - startAngle + fullCircle) % fullCircle;
        const normalizedEnd =
          normalizedStart + (segment.end - segment.start);

        if (
          normalizedPointer >= normalizedStart &&
          normalizedPointer <= normalizedEnd
        ) {
          return segment.index;
        }
      }

      return -1;
    },
    [activeIndex, data, totalValue],
  );

  const openSegment = (entry: ChartDatum, index: number) => {
    onSelect({
      title,
      segment: entry,
      color: colors[index],
      valueKind,
    });
  };

  const toggleSegment = (index: number) => {
    setActiveIndex((current) => (current === index ? null : index));
  };

  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center gap-4 lg:flex-row lg:gap-5">
      <div className="chart-wrapper relative aspect-[5/4] w-full max-w-[520px] lg:min-w-0 lg:flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-label={t("analytics.chartAria", { title })}
          onClick={(event) => {
            const index = findSegment(event);
            if (index >= 0) toggleSegment(index);
          }}
          onDoubleClick={(event) => {
            const index = findSegment(event);
            if (index >= 0) openSegment(data[index], index);
          }}
          onMouseMove={(event) => {
            event.currentTarget.style.cursor =
              findSegment(event) >= 0 ? "pointer" : "default";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.cursor = "default";
          }}
        />

        <div className="chart-center pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center text-center leading-none">
          <div className="chart-total text-[34px] font-bold text-gray-900">
            {numberFormatter.format(centerTotal ?? totalUnits)}
          </div>
          <div className="chart-unit mt-1.5 text-sm font-normal text-gray-400">
            {t("common.units")}
          </div>
        </div>
      </div>

      <div className="grid w-full min-w-0 max-w-[230px] gap-1.5">
        {data.map((entry, index) => (
          <button
            key={entry.name}
            type="button"
            onClick={() => toggleSegment(index)}
            onDoubleClick={() => openSegment(entry, index)}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm shadow-sm"
              style={{ backgroundColor: colors[index] }}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 group-hover:text-zinc-900">
              {dataLabel(entry.name)}
            </span>
            <strong className="shrink-0 text-xs font-semibold text-zinc-800">
              {valueKind === "money"
                ? formatMoney(entry.value, locale)
                : `${numberFormatter.format(entry.value)} ${t("common.unitShort")}`}
            </strong>
          </button>
        ))}
        <p className="mt-2 px-2 text-[11px] leading-4 text-zinc-400">
          {t("analytics.clickHint")}
        </p>
      </div>
    </div>
  );
}

interface ChartSelection {
  title: string;
  segment: ChartDatum;
  color: string;
  valueKind: "count" | "money";
}

function DetailsModal({
  selection,
  onClose,
}: {
  selection: ChartSelection;
  onClose: () => void;
}) {
  const { dataLabel, locale, t } = useAppSettings();
  const totalQuantity = selection.segment.records.reduce(
    (sum, record) => sum + record.quantity,
    0,
  );
  const totalPrice = selection.segment.records.reduce(
    (sum, record) => sum + record.price,
    0,
  );
  const responsibleCount = new Set(
    selection.segment.records
      .map((record) => record.responsible)
      .filter((responsible) => responsible && responsible !== "-"),
  ).size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("analytics.detailsAria", { name: dataLabel(selection.segment.name) })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-5 sm:px-7">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="mt-1 h-12 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: selection.color }}
            />
            <div className="min-w-0">
              <p className="text-sm text-zinc-400">{selection.title}</p>
              <h2 className="truncate text-2xl font-bold text-zinc-900">
                {dataLabel(selection.segment.name)}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t("analytics.detailsSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-zinc-100 bg-zinc-50/70 p-5 sm:grid-cols-3 sm:px-7">
          <div className="rounded-xl border border-zinc-100 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <PackageSearch className="h-4 w-4 text-emerald-600" />
              {t("items.quantity")}
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-900">{totalQuantity} {t("common.piecesShort")}</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Users className="h-4 w-4 text-emerald-600" />
              {t("analytics.responsibles")}
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-900">{responsibleCount}</p>
          </div>
          <div className="rounded-xl border border-zinc-100 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Banknote className="h-4 w-4 text-emerald-600" />
              {t("analytics.totalCost")}
            </div>
            <p className="mt-2 text-2xl font-bold text-zinc-900">{formatMoney(totalPrice, locale)}</p>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="min-w-[920px] w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e4e4e7]">
              <tr className="text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-6 py-4 font-medium">{t("items.responsible")}</th>
                <th className="px-4 py-4 font-medium">{t("analytics.whatTaken")}</th>
                <th className="px-4 py-4 font-medium">{t("items.qrCode")}</th>
                <th className="px-4 py-4 font-medium">{t("items.location")}</th>
                <th className="px-4 py-4 text-center font-medium">{t("items.quantity")}</th>
                <th className="px-4 py-4 text-right font-medium">{t("analytics.cost")}</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody>
              {selection.segment.records.map((record) => (
                <tr key={record.id} className="border-b border-zinc-100 hover:bg-emerald-50/40">
                  <td className="px-6 py-4 font-medium text-zinc-800">
                    {record.responsible && record.responsible !== "-"
                      ? record.responsible
                      : t("status.unassigned")}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-zinc-800">
                      {dataLabel(record.itemType || record.name)}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {record.brandModel || t("analytics.modelMissing")}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-zinc-600">{record.qrCode || "—"}</td>
                  <td className="px-4 py-4 text-zinc-600">{record.location}</td>
                  <td className="px-4 py-4 text-center font-semibold text-zinc-800">
                    {record.quantity}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-zinc-800">
                    {formatMoney(record.price, locale)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/items/${record.id}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-100"
                      aria-label={t("analytics.openItem", { name: dataLabel(record.itemType || record.name) })}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsCharts({
  data: initialData,
  canBulkManage = false,
  canExport = false,
}: {
  data: AnalyticsDashboardData;
  canBulkManage?: boolean;
  canExport?: boolean;
}) {
  const { locale, t } = useAppSettings();
  const [building, setBuilding] = useState("all");
  const [itemType, setItemType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const data = useMemo(() => filteredDashboard(initialData, { building, itemType, dateFrom, dateTo }), [building, dateFrom, dateTo, initialData, itemType]);
  const buildings = useMemo(() => Array.from(new Set(initialData.records.map((record) => record.building))).sort(), [initialData.records]);
  const itemTypes = useMemo(() => Array.from(new Set(initialData.records.map((record) => record.itemType))).sort(), [initialData.records]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const assignedPercent = data.summary.totalItems
    ? (data.summary.assigned / data.summary.totalItems) * 100
    : 0;
  const photoPercent = data.summary.totalItems
    ? (data.summary.withPhoto / data.summary.totalItems) * 100
    : 0;

  async function exportReport() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/inventory/excel?action=export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset: "analytics", itemIds: data.records.map((record) => record.id) }) });
      if (!response.ok) throw new Error("export_failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "analytics-report.xlsx"; anchor.click(); URL.revokeObjectURL(url);
    } catch {
      setExportError(t("excel.requestFailed"));
    } finally { setExporting(false); }
  }

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
              <p className="text-sm text-slate-300">{t("analytics.totalValueTitle")}</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                {formatMoney(data.summary.totalValue, locale)}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                {t("analytics.description", { count: numberFormatter.format(data.summary.totalItems) })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <PercentRing value={data.summary.completion} />
            <div>
              <p className="text-sm font-medium">{t("analytics.databaseCompletion")}</p>
              <p className="mt-1 text-xs text-slate-300">
                {t("analytics.recordsProgress", { current: data.summary.totalItems, target: data.summary.targetItems })}
              </p>
              <Link
                href="/items"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-400/50 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/10"
              >
                {t("analytics.viewItems")} <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
        {canExport ? (
          <div className="relative mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void exportReport()} disabled={exporting} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/50 px-4 text-sm font-semibold text-emerald-200 hover:bg-white/10 disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" />{t("analytics.exportReport")}</button>
            {exportError ? <p role="alert" className="text-sm text-rose-200">{exportError}</p> : null}
          </div>
        ) : null}
      </section>

      <section aria-label={t("analytics.filters")} className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
        <select value={building} onChange={(event) => setBuilding(event.target.value)} aria-label={t("analytics.buildingFilter")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"><option value="all">{t("analytics.allBuildings")}</option>{buildings.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={itemType} onChange={(event) => setItemType(event.target.value)} aria-label={t("analytics.itemTypeFilter")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"><option value="all">{t("analytics.allItemTypes")}</option>{itemTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} aria-label={t("analytics.dateFrom")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm" />
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} aria-label={t("analytics.dateTo")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm" />
      </section>

      <AnalyticsExcelTools
        canBulkManage={canBulkManage}
        canExport={canExport}
        itemIds={data.records.map((record) => record.id)}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={t("analytics.totalItems")}
          value={numberFormatter.format(data.summary.totalItems)}
          hint={t("analytics.plannedDatabase", { count: numberFormatter.format(data.summary.targetItems) })}
          progress={data.summary.completion}
          icon={Boxes}
        />
        <SummaryCard
          label={t("analytics.assigned")}
          value={`${assignedPercent.toFixed(1)}%`}
          hint={t("analytics.completedRecords", { count: data.summary.assigned })}
          progress={assignedPercent}
          icon={UserCheck}
        />
        <SummaryCard
          label={t("analytics.hasPhoto")}
          value={`${photoPercent.toFixed(1)}%`}
          hint={t("analytics.photosInDatabase", { count: data.summary.withPhoto })}
          progress={photoPercent}
          icon={Camera}
        />
        <SummaryCard
          label={t("analytics.distributedObjects")}
          value={numberFormatter.format(data.objects.length)}
          hint={t("analytics.locationsInDatabase", { count: data.locations.length })}
          progress={Math.min(100, data.objects.length * 20)}
          icon={Boxes}
        />
      </div>

      <div className="grid gap-5 min-[1700px]:grid-cols-2">
        <ChartCard title={t("analytics.brands")} subtitle={t("analytics.brandsSubtitle")}>
          <DonutChart
            data={data.brands}
            title={t("analytics.brands")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </ChartCard>
        <ChartCard title={t("analytics.types")} subtitle={t("analytics.typesSubtitle")}>
          <DonutChart
            data={data.types}
            title={t("analytics.types")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </ChartCard>
        <ChartCard title={t("analytics.statuses")} subtitle={t("analytics.statusesSubtitle")}>
          <DonutChart
            data={data.statuses}
            title={t("analytics.statuses")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
            statusColors
          />
        </ChartCard>
        <ChartCard title={t("analytics.locations")} subtitle={t("analytics.locationsSubtitle")}>
          <DonutChart
            data={data.locations}
            title={t("analytics.locations")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </ChartCard>
        <ChartCard
          title={t("analytics.valueByType")}
          subtitle={t("analytics.valueByTypeSubtitle")}
        >
          <DonutChart
            data={data.valueByType}
            title={t("analytics.valueByType")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
            valueKind="money"
          />
        </ChartCard>
        <ChartCard title={t("analytics.responsiblePeople")} subtitle={t("analytics.responsibleSubtitle")}>
          <DonutChart
            data={data.responsibles}
            title={t("analytics.responsiblePeople")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </ChartCard>
        <ChartCard title={t("analytics.objects")} subtitle={t("analytics.objectsSubtitle")}>
          <DonutChart
            data={data.objects}
            title={t("analytics.objects")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </ChartCard>
      </div>

      {selection ? (
        <DetailsModal selection={selection} onClose={() => setSelection(null)} />
      ) : null}
    </div>
  );
}
