"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { AnalyticsRecord, ChartDatum } from "@/lib/analytics-dashboard";
import type { AnalyticsChartSelection, AnalyticsChartTone } from "@/lib/analytics-chart-selection";
import { formatAnalyticsMoney } from "@/lib/analytics-formatters";

const CHART_TONES: AnalyticsChartTone[] = ["green", "sky", "violet", "amber", "rose", "cyan", "lime", "ochre"];

const TONE_COLORS: Record<AnalyticsChartTone, string> = {
  green: "#16a34a",
  sky: "#0ea5e9",
  violet: "#7c3aed",
  amber: "#f59e0b",
  rose: "#e11d48",
  cyan: "#0891b2",
  lime: "#65a30d",
  ochre: "#a16207",
  neutral: "#a1a1aa",
};

const STATUS_TONES: Record<string, AnalyticsChartTone> = {
  Работник: "violet",
  Маркировано: "green",
  "Не распределено": "neutral",
  Активен: "sky",
  "На обслуживании": "amber",
  Списано: "rose",
};

function shadeHex(hex: string, amount: number) {
  const cleanHex = hex.replace("#", "");
  const numericColor = Number.parseInt(cleanHex, 16);
  const red = Math.min(255, Math.max(0, (numericColor >> 16) + amount));
  const green = Math.min(255, Math.max(0, ((numericColor >> 8) & 0xff) + amount));
  const blue = Math.min(255, Math.max(0, (numericColor & 0xff) + amount));

  return `#${((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0")}`;
}

function chartTone(entry: ChartDatum, index: number, useStatusColors: boolean) {
  if (useStatusColors && STATUS_TONES[entry.name]) return STATUS_TONES[entry.name];
  return CHART_TONES[index % CHART_TONES.length];
}

export default function AnalyticsDonutChart({
  data,
  title,
  onSelect,
  centerTotal,
  statusColors = false,
  valueKind = "count",
}: {
  data: ChartDatum[];
  title: string;
  onSelect: (selection: AnalyticsChartSelection) => void;
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
  const tones = useMemo(
    () => data.map((entry, index) => chartTone(entry, index, statusColors)),
    [data, statusColors],
  );
  const colors = useMemo(() => tones.map((tone) => TONE_COLORS[tone]), [tones]);
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
      tone: tones[index],
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
                ? formatAnalyticsMoney(entry.value, locale)
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

