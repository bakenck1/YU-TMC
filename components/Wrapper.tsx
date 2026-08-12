import type { ElementType, ReactNode } from "react";

type Display = "block" | "flex" | "grid" | "inline-flex";
type Direction = "row" | "column";
type Alignment = "start" | "center" | "end" | "stretch" | "baseline";
type Justification = "start" | "center" | "end" | "between" | "around" | "evenly";
type Space = "none" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
type Width = "auto" | "full" | "fit";
type Overflow = "visible" | "hidden" | "auto" | "x-auto";
type Position = "static" | "relative" | "absolute" | "fixed" | "sticky";
type Columns = 1 | 2 | 3 | 4 | 5 | 6;
type Breakpoint = "sm" | "md" | "lg" | "xl";

interface ResponsiveLayout {
  at: Breakpoint;
  display?: Display;
  direction?: Direction;
  align?: Alignment;
  justify?: Justification;
  gap?: Space;
  columns?: Columns;
  width?: Width;
}

interface EdgeSpacing {
  all?: Space;
  x?: Space;
  y?: Space;
  top?: Space;
  right?: Space;
  bottom?: Space;
  left?: Space;
}

export interface WrapperProps {
  children: ReactNode;
  as?: ElementType;
  display?: Display;
  direction?: Direction;
  align?: Alignment;
  justify?: Justification;
  gap?: Space;
  padding?: Space | EdgeSpacing;
  margin?: Space | EdgeSpacing;
  columns?: Columns;
  responsive?: ResponsiveLayout;
  wrap?: boolean;
  grow?: boolean;
  shrink?: boolean;
  width?: Width;
  minWidthZero?: boolean;
  overflow?: Overflow;
  position?: Position;
  inset?: "none" | "zero";
}

const DISPLAY: Record<Display, string> = {
  block: "block",
  flex: "flex",
  grid: "grid",
  "inline-flex": "inline-flex",
};

const DIRECTION: Record<Direction, string> = { row: "flex-row", column: "flex-col" };
const ALIGN: Record<Alignment, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
};
const JUSTIFY: Record<Justification, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};
const GAP: Record<Space, string> = {
  none: "gap-0",
  "2xs": "gap-1",
  xs: "gap-2",
  sm: "gap-3",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
  "2xl": "gap-12",
};
const COLUMNS: Record<Columns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

const SPACE: Record<"padding" | "margin", Record<keyof EdgeSpacing, Record<Space, string>>> = {
  padding: {
    all: { none: "p-0", "2xs": "p-1", xs: "p-2", sm: "p-3", md: "p-4", lg: "p-6", xl: "p-8", "2xl": "p-12" },
    x: { none: "px-0", "2xs": "px-1", xs: "px-2", sm: "px-3", md: "px-4", lg: "px-6", xl: "px-8", "2xl": "px-12" },
    y: { none: "py-0", "2xs": "py-1", xs: "py-2", sm: "py-3", md: "py-4", lg: "py-6", xl: "py-8", "2xl": "py-12" },
    top: { none: "pt-0", "2xs": "pt-1", xs: "pt-2", sm: "pt-3", md: "pt-4", lg: "pt-6", xl: "pt-8", "2xl": "pt-12" },
    right: { none: "pr-0", "2xs": "pr-1", xs: "pr-2", sm: "pr-3", md: "pr-4", lg: "pr-6", xl: "pr-8", "2xl": "pr-12" },
    bottom: { none: "pb-0", "2xs": "pb-1", xs: "pb-2", sm: "pb-3", md: "pb-4", lg: "pb-6", xl: "pb-8", "2xl": "pb-12" },
    left: { none: "pl-0", "2xs": "pl-1", xs: "pl-2", sm: "pl-3", md: "pl-4", lg: "pl-6", xl: "pl-8", "2xl": "pl-12" },
  },
  margin: {
    all: { none: "m-0", "2xs": "m-1", xs: "m-2", sm: "m-3", md: "m-4", lg: "m-6", xl: "m-8", "2xl": "m-12" },
    x: { none: "mx-0", "2xs": "mx-1", xs: "mx-2", sm: "mx-3", md: "mx-4", lg: "mx-6", xl: "mx-8", "2xl": "mx-12" },
    y: { none: "my-0", "2xs": "my-1", xs: "my-2", sm: "my-3", md: "my-4", lg: "my-6", xl: "my-8", "2xl": "my-12" },
    top: { none: "mt-0", "2xs": "mt-1", xs: "mt-2", sm: "mt-3", md: "mt-4", lg: "mt-6", xl: "mt-8", "2xl": "mt-12" },
    right: { none: "mr-0", "2xs": "mr-1", xs: "mr-2", sm: "mr-3", md: "mr-4", lg: "mr-6", xl: "mr-8", "2xl": "mr-12" },
    bottom: { none: "mb-0", "2xs": "mb-1", xs: "mb-2", sm: "mb-3", md: "mb-4", lg: "mb-6", xl: "mb-8", "2xl": "mb-12" },
    left: { none: "ml-0", "2xs": "ml-1", xs: "ml-2", sm: "ml-3", md: "ml-4", lg: "ml-6", xl: "ml-8", "2xl": "ml-12" },
  },
};

const RESPONSIVE = {
  sm: {
    display: { block: "sm:block", flex: "sm:flex", grid: "sm:grid", "inline-flex": "sm:inline-flex" },
    direction: { row: "sm:flex-row", column: "sm:flex-col" },
    align: { start: "sm:items-start", center: "sm:items-center", end: "sm:items-end", stretch: "sm:items-stretch", baseline: "sm:items-baseline" },
    justify: { start: "sm:justify-start", center: "sm:justify-center", end: "sm:justify-end", between: "sm:justify-between", around: "sm:justify-around", evenly: "sm:justify-evenly" },
    gap: { none: "sm:gap-0", "2xs": "sm:gap-1", xs: "sm:gap-2", sm: "sm:gap-3", md: "sm:gap-4", lg: "sm:gap-6", xl: "sm:gap-8", "2xl": "sm:gap-12" },
    columns: { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" },
    width: { auto: "sm:w-auto", full: "sm:w-full", fit: "sm:w-fit" },
  },
  md: {
    display: { block: "md:block", flex: "md:flex", grid: "md:grid", "inline-flex": "md:inline-flex" },
    direction: { row: "md:flex-row", column: "md:flex-col" },
    align: { start: "md:items-start", center: "md:items-center", end: "md:items-end", stretch: "md:items-stretch", baseline: "md:items-baseline" },
    justify: { start: "md:justify-start", center: "md:justify-center", end: "md:justify-end", between: "md:justify-between", around: "md:justify-around", evenly: "md:justify-evenly" },
    gap: { none: "md:gap-0", "2xs": "md:gap-1", xs: "md:gap-2", sm: "md:gap-3", md: "md:gap-4", lg: "md:gap-6", xl: "md:gap-8", "2xl": "md:gap-12" },
    columns: { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5", 6: "md:grid-cols-6" },
    width: { auto: "md:w-auto", full: "md:w-full", fit: "md:w-fit" },
  },
  lg: {
    display: { block: "lg:block", flex: "lg:flex", grid: "lg:grid", "inline-flex": "lg:inline-flex" },
    direction: { row: "lg:flex-row", column: "lg:flex-col" },
    align: { start: "lg:items-start", center: "lg:items-center", end: "lg:items-end", stretch: "lg:items-stretch", baseline: "lg:items-baseline" },
    justify: { start: "lg:justify-start", center: "lg:justify-center", end: "lg:justify-end", between: "lg:justify-between", around: "lg:justify-around", evenly: "lg:justify-evenly" },
    gap: { none: "lg:gap-0", "2xs": "lg:gap-1", xs: "lg:gap-2", sm: "lg:gap-3", md: "lg:gap-4", lg: "lg:gap-6", xl: "lg:gap-8", "2xl": "lg:gap-12" },
    columns: { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" },
    width: { auto: "lg:w-auto", full: "lg:w-full", fit: "lg:w-fit" },
  },
  xl: {
    display: { block: "xl:block", flex: "xl:flex", grid: "xl:grid", "inline-flex": "xl:inline-flex" },
    direction: { row: "xl:flex-row", column: "xl:flex-col" },
    align: { start: "xl:items-start", center: "xl:items-center", end: "xl:items-end", stretch: "xl:items-stretch", baseline: "xl:items-baseline" },
    justify: { start: "xl:justify-start", center: "xl:justify-center", end: "xl:justify-end", between: "xl:justify-between", around: "xl:justify-around", evenly: "xl:justify-evenly" },
    gap: { none: "xl:gap-0", "2xs": "xl:gap-1", xs: "xl:gap-2", sm: "xl:gap-3", md: "xl:gap-4", lg: "xl:gap-6", xl: "xl:gap-8", "2xl": "xl:gap-12" },
    columns: { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" },
    width: { auto: "xl:w-auto", full: "xl:w-full", fit: "xl:w-fit" },
  },
} as const;

function spacingClasses(kind: "padding" | "margin", value?: Space | EdgeSpacing) {
  if (!value) return [];
  if (typeof value === "string") return [SPACE[kind].all[value]];
  return (Object.entries(value) as Array<[keyof EdgeSpacing, Space]>).map(([edge, space]) => SPACE[kind][edge][space]);
}

export default function Wrapper({
  children,
  as: Component = "div",
  display = "flex",
  direction,
  align,
  justify,
  gap,
  padding,
  margin,
  columns,
  responsive,
  wrap = false,
  grow = false,
  shrink,
  width,
  minWidthZero = false,
  overflow,
  position,
  inset = "none",
}: WrapperProps) {
  const responsiveMap = responsive ? RESPONSIVE[responsive.at] : null;
  const classes = [
    DISPLAY[display],
    direction ? DIRECTION[direction] : "",
    align ? ALIGN[align] : "",
    justify ? JUSTIFY[justify] : "",
    gap ? GAP[gap] : "",
    columns ? COLUMNS[columns] : "",
    ...spacingClasses("padding", padding),
    ...spacingClasses("margin", margin),
    wrap ? "flex-wrap" : "",
    grow ? "grow" : "",
    shrink === true ? "shrink" : shrink === false ? "shrink-0" : "",
    width === "full" ? "w-full" : width === "fit" ? "w-fit" : width === "auto" ? "w-auto" : "",
    minWidthZero ? "min-w-0" : "",
    overflow === "hidden" ? "overflow-hidden" : overflow === "auto" ? "overflow-auto" : overflow === "x-auto" ? "overflow-x-auto" : overflow === "visible" ? "overflow-visible" : "",
    position ?? "",
    inset === "zero" ? "inset-0" : "",
    responsive?.display && responsiveMap ? responsiveMap.display[responsive.display] : "",
    responsive?.direction && responsiveMap ? responsiveMap.direction[responsive.direction] : "",
    responsive?.align && responsiveMap ? responsiveMap.align[responsive.align] : "",
    responsive?.justify && responsiveMap ? responsiveMap.justify[responsive.justify] : "",
    responsive?.gap && responsiveMap ? responsiveMap.gap[responsive.gap] : "",
    responsive?.columns && responsiveMap ? responsiveMap.columns[responsive.columns] : "",
    responsive?.width && responsiveMap ? responsiveMap.width[responsive.width] : "",
  ].filter(Boolean).join(" ");

  return <Component className={classes}>{children}</Component>;
}
