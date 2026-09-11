import { employeeItemTabFromParam } from "@/lib/employee-items-tabs";

export interface InventoryTableFilters {
  category: string;
  location: string;
  statusKey: string;
  brand: string;
  model: string;
  itemType: string;
  building: string;
  responsible: string;
}

export interface InventoryTableViewState {
  query: string;
  filters: InventoryTableFilters;
  page: number;
  pageSize: number;
}

export type InventorySearchParams = Record<
  string,
  string | string[] | undefined
>;

type ReadableSearchParams = {
  get(name: string): string | null;
};

export const INVENTORY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const DEFAULT_PAGE_SIZE = INVENTORY_PAGE_SIZE_OPTIONS[0];
const MAX_TEXT_PARAM_LENGTH = 300;
const MAX_PAGE = 1_000_000;
const MAX_LIST_HREF_LENGTH = 3_500;
const MAX_RETURN_HREF_LENGTH = 4_000;
const RETURN_HREF_BASE = "https://inventory.local";
const STATIC_INVENTORY_RETURN_PATHS = new Set([
  "/items/decommissioned",
  "/tmc/issue",
]);

export const EMPTY_TABLE_FILTERS: InventoryTableFilters = {
  category: "all",
  location: "all",
  statusKey: "all",
  brand: "",
  model: "",
  itemType: "",
  building: "",
  responsible: "",
};

export const DEFAULT_INVENTORY_TABLE_VIEW_STATE: InventoryTableViewState = {
  query: "",
  filters: EMPTY_TABLE_FILTERS,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

const PARAMETER_NAMES = {
  query: "q",
  category: "category",
  location: "location",
  statusKey: "status",
  brand: "brand",
  model: "model",
  itemType: "itemType",
  building: "building",
  responsible: "responsible",
  page: "page",
  pageSize: "pageSize",
} as const;

export function parseInventoryTableViewState(
  searchParams: InventorySearchParams | ReadableSearchParams,
): InventoryTableViewState {
  return {
    query: readText(searchParams, PARAMETER_NAMES.query),
    filters: {
      category: readChoice(searchParams, PARAMETER_NAMES.category),
      location: readChoice(searchParams, PARAMETER_NAMES.location),
      statusKey: readChoice(searchParams, PARAMETER_NAMES.statusKey),
      brand: readText(searchParams, PARAMETER_NAMES.brand),
      model: readText(searchParams, PARAMETER_NAMES.model),
      itemType: readText(searchParams, PARAMETER_NAMES.itemType),
      building: readText(searchParams, PARAMETER_NAMES.building),
      responsible: readText(searchParams, PARAMETER_NAMES.responsible),
    },
    page: readPositiveInteger(
      searchParams,
      PARAMETER_NAMES.page,
      1,
      MAX_PAGE,
    ),
    pageSize: readPageSize(searchParams),
  };
}

export function inventoryTableViewHref(
  pathname: string,
  state: InventoryTableViewState,
  preservedParams: Readonly<Record<string, string | undefined>> = {},
) {
  const params = new URLSearchParams();

  Object.entries(preservedParams).forEach(([name, value]) => {
    if (value) params.set(name, value);
  });

  setNonEmpty(params, PARAMETER_NAMES.query, state.query);
  setNonDefault(
    params,
    PARAMETER_NAMES.category,
    state.filters.category,
    "all",
  );
  setNonDefault(
    params,
    PARAMETER_NAMES.location,
    state.filters.location,
    "all",
  );
  setNonDefault(
    params,
    PARAMETER_NAMES.statusKey,
    state.filters.statusKey,
    "all",
  );
  setNonEmpty(params, PARAMETER_NAMES.brand, state.filters.brand);
  setNonEmpty(params, PARAMETER_NAMES.model, state.filters.model);
  setNonEmpty(params, PARAMETER_NAMES.itemType, state.filters.itemType);
  setNonEmpty(params, PARAMETER_NAMES.building, state.filters.building);
  setNonEmpty(params, PARAMETER_NAMES.responsible, state.filters.responsible);
  if (state.page > 1) params.set(PARAMETER_NAMES.page, String(state.page));
  const pageSize = normalizePageSize(state.pageSize);
  if (pageSize !== DEFAULT_PAGE_SIZE) {
    params.set(PARAMETER_NAMES.pageSize, String(pageSize));
  }

  const query = params.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  if (href.length <= MAX_LIST_HREF_LENGTH) return href;

  return boundedInventoryTableViewHref(pathname, state, preservedParams);
}

export function inventoryDetailsHref(
  itemPath: string,
  returnHref: string | undefined,
) {
  if (!returnHref) return itemPath;
  const params = new URLSearchParams({ returnTo: returnHref });
  return `${itemPath}?${params.toString()}`;
}

/**
 * Accepts only inventory-list destinations and rebuilds their query from the
 * known state fields. This keeps return links internal without rejecting safe
 * filter text such as a backslash inside an encoded query value.
 */
export function canonicalInventoryDetailsReturnHref(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > MAX_RETURN_HREF_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return null;
  }

  try {
    const url = new URL(value, RETURN_HREF_BASE);
    if (url.origin !== RETURN_HREF_BASE) return null;

    if (url.pathname === "/items") {
      const tab = employeeItemTabFromParam(url.searchParams.get("tab"));
      return inventoryTableViewHref(
        "/items",
        parseInventoryTableViewState(url.searchParams),
        { tab: tab === "active" ? undefined : tab },
      );
    }

    return STATIC_INVENTORY_RETURN_PATHS.has(url.pathname)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

function readParam(
  searchParams: InventorySearchParams | ReadableSearchParams,
  name: string,
) {
  if (isReadableSearchParams(searchParams)) {
    return searchParams.get(name) ?? undefined;
  }
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

function isReadableSearchParams(
  searchParams: InventorySearchParams | ReadableSearchParams,
): searchParams is ReadableSearchParams {
  return typeof (searchParams as Partial<ReadableSearchParams>).get === "function";
}

function readText(
  searchParams: InventorySearchParams | ReadableSearchParams,
  name: string,
) {
  return truncateText(readParam(searchParams, name) ?? "");
}

function readChoice(
  searchParams: InventorySearchParams | ReadableSearchParams,
  name: string,
) {
  return readText(searchParams, name) || "all";
}

function readPositiveInteger(
  searchParams: InventorySearchParams | ReadableSearchParams,
  name: string,
  fallback: number,
  maximum: number,
) {
  const raw = readParam(searchParams, name);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function readPageSize(
  searchParams: InventorySearchParams | ReadableSearchParams,
) {
  const raw = readParam(searchParams, PARAMETER_NAMES.pageSize);
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_PAGE_SIZE;
  return normalizePageSize(Number(raw));
}

function normalizePageSize(value: number) {
  return INVENTORY_PAGE_SIZE_OPTIONS.find((size) => size === value)
    ?? DEFAULT_PAGE_SIZE;
}

function setNonEmpty(params: URLSearchParams, name: string, value: string) {
  if (value) params.set(name, truncateText(value));
}

function setNonDefault(
  params: URLSearchParams,
  name: string,
  value: string,
  defaultValue: string,
) {
  if (value && value !== defaultValue) {
    params.set(name, truncateText(value));
  }
}

function truncateText(value: string) {
  return Array.from(value).slice(0, MAX_TEXT_PARAM_LENGTH).join("");
}

function boundedInventoryTableViewHref(
  pathname: string,
  state: InventoryTableViewState,
  preservedParams: Readonly<Record<string, string | undefined>>,
) {
  const params = new URLSearchParams();

  if (state.page > 1) params.set(PARAMETER_NAMES.page, String(state.page));
  const pageSize = normalizePageSize(state.pageSize);
  if (pageSize !== DEFAULT_PAGE_SIZE) {
    params.set(PARAMETER_NAMES.pageSize, String(pageSize));
  }
  Object.entries(preservedParams).forEach(([name, value]) => {
    if (value) setParamWithinHrefBudget(pathname, params, name, value);
  });

  setParamWithinHrefBudget(pathname, params, PARAMETER_NAMES.query, state.query);
  setNonDefaultWithinHrefBudget(
    pathname,
    params,
    PARAMETER_NAMES.category,
    state.filters.category,
    "all",
  );
  setNonDefaultWithinHrefBudget(
    pathname,
    params,
    PARAMETER_NAMES.location,
    state.filters.location,
    "all",
  );
  setNonDefaultWithinHrefBudget(
    pathname,
    params,
    PARAMETER_NAMES.statusKey,
    state.filters.statusKey,
    "all",
  );
  setParamWithinHrefBudget(pathname, params, PARAMETER_NAMES.brand, state.filters.brand);
  setParamWithinHrefBudget(pathname, params, PARAMETER_NAMES.model, state.filters.model);
  setParamWithinHrefBudget(pathname, params, PARAMETER_NAMES.itemType, state.filters.itemType);
  setParamWithinHrefBudget(pathname, params, PARAMETER_NAMES.building, state.filters.building);
  setParamWithinHrefBudget(
    pathname,
    params,
    PARAMETER_NAMES.responsible,
    state.filters.responsible,
  );

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function setNonDefaultWithinHrefBudget(
  pathname: string,
  params: URLSearchParams,
  name: string,
  value: string,
  defaultValue: string,
) {
  if (value && value !== defaultValue) {
    setParamWithinHrefBudget(pathname, params, name, value);
  }
}

function setParamWithinHrefBudget(
  pathname: string,
  params: URLSearchParams,
  name: string,
  value: string,
) {
  const characters = Array.from(truncateText(value));
  if (characters.length === 0) return;

  let lower = 0;
  let upper = characters.length;
  while (lower < upper) {
    const length = Math.ceil((lower + upper) / 2);
    const candidate = new URLSearchParams(params);
    candidate.set(name, characters.slice(0, length).join(""));
    const query = candidate.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    if (href.length <= MAX_LIST_HREF_LENGTH) lower = length;
    else upper = length - 1;
  }

  if (lower > 0) params.set(name, characters.slice(0, lower).join(""));
}
