import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { employeeItemTabFromParam } from "../lib/employee-items-tabs";
import {
  canonicalInventoryDetailsReturnHref,
  DEFAULT_INVENTORY_TABLE_VIEW_STATE,
  inventoryDetailsHref,
  inventoryTableViewHref,
  parseInventoryTableViewState,
  type InventoryTableViewState,
} from "../lib/inventory-list-state";

const FILTERED_THIRD_PAGE: InventoryTableViewState = {
  query: "projector 301",
  filters: {
    category: "electronics",
    location: "301",
    statusKey: "lifecycle:active",
    brand: "Epson",
    model: "EB-X49",
    itemType: "Projector",
    building: "Main campus",
    responsible: "Employee",
  },
  page: 3,
  pageSize: 20,
};

test("inventory list URL round-trips filters and the current page", () => {
  const href = inventoryTableViewHref("/items", FILTERED_THIRD_PAGE, {
    tab: "maintenance",
  });
  const url = new URL(href, "https://inventory.test");

  assert.equal(url.pathname, "/items");
  assert.equal(url.searchParams.get("tab"), "maintenance");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("pageSize"), "20");
  assert.deepEqual(
    parseInventoryTableViewState(url.searchParams),
    FILTERED_THIRD_PAGE,
  );
});

test("default list state produces a clean URL after an explicit clear", () => {
  assert.equal(
    inventoryTableViewHref("/items", DEFAULT_INVENTORY_TABLE_VIEW_STATE),
    "/items",
  );
});

test("invalid pagination parameters cannot break or over-expand the table", () => {
  const state = parseInventoryTableViewState(
    new URLSearchParams("page=-3&pageSize=999999999999999999999"),
  );

  assert.equal(state.page, 1);
  assert.equal(state.pageSize, 10);
  assert.equal(
    parseInventoryTableViewState(new URLSearchParams("pageSize=25")).pageSize,
    10,
  );
});

test("item links carry an encoded return URL for filters and pagination", () => {
  const returnHref = inventoryTableViewHref("/items", FILTERED_THIRD_PAGE);
  const detailsHref = inventoryDetailsHref("/items/item-21", returnHref);
  const url = new URL(detailsHref, "https://inventory.test");

  assert.equal(url.pathname, "/items/item-21");
  assert.equal(url.searchParams.get("returnTo"), returnHref);
  assert.deepEqual(
    parseInventoryTableViewState(
      new URL(url.searchParams.get("returnTo")!, "https://inventory.test")
        .searchParams,
    ),
    FILTERED_THIRD_PAGE,
  );
});

test("inventory return URLs preserve encoded filter text and canonical state", () => {
  const state: InventoryTableViewState = {
    ...FILTERED_THIRD_PAGE,
    query: String.raw`A\B Қазақ ?&#%+`,
    filters: {
      ...FILTERED_THIRD_PAGE.filters,
      brand: String.raw`ACME\Series + 100%`,
    },
  };
  const href = inventoryTableViewHref("/items", state, {
    tab: "maintenance",
  });

  assert.equal(canonicalInventoryDetailsReturnHref(href), href);
  assert.equal(
    canonicalInventoryDetailsReturnHref("/items?q=A%5CB"),
    "/items?q=A%5CB",
  );
});

test("inventory return URLs reject external and unrelated destinations", () => {
  const rejected = [
    undefined,
    ["/items"],
    "https://evil.example/items",
    "//evil.example/items",
    "javascript:alert(1)",
    "/settings",
    "/items/../api/auth/google",
    "/items/item-1",
    "/tmc/issue/extra",
  ];

  rejected.forEach((value) => {
    assert.equal(canonicalInventoryDetailsReturnHref(value), null);
  });
});

test("inventory return URLs drop unknown data and normalize known values", () => {
  assert.equal(
    canonicalInventoryDetailsReturnHref(
      "/items?q=first&q=second&page=0003&pageSize=20&tab=unknown&junk=value#fragment",
    ),
    "/items?q=first&page=3&pageSize=20",
  );
  assert.equal(
    canonicalInventoryDetailsReturnHref(
      "/items/decommissioned?junk=value#fragment",
    ),
    "/items/decommissioned",
  );
  assert.equal(
    canonicalInventoryDetailsReturnHref("/tmc/issue?junk=value"),
    "/tmc/issue",
  );
  assert.equal(canonicalInventoryDetailsReturnHref(`/items?q=${"x".repeat(40_000)}`), null);
});

test("large Unicode filter state stays below practical HTTP request-line limits", () => {
  const longValue = "界".repeat(300);
  const state: InventoryTableViewState = {
    query: longValue,
    filters: {
      category: longValue,
      location: longValue,
      statusKey: longValue,
      brand: longValue,
      model: longValue,
      itemType: longValue,
      building: longValue,
      responsible: longValue,
    },
    page: 999_999,
    pageSize: 100,
  };

  const returnHref = inventoryTableViewHref("/items", state, {
    tab: "maintenance",
  });
  const detailsHref = inventoryDetailsHref("/items/item-1", returnHref);

  assert.ok(returnHref.length <= 3_500);
  assert.ok(detailsHref.length < 7_000);
  assert.equal(new URL(returnHref, "https://inventory.test").searchParams.get("page"), "999999");
  assert.equal(
    new URL(returnHref, "https://inventory.test").searchParams.get("tab"),
    "maintenance",
  );
});

test("employee inventory tab is validated and can be restored", () => {
  assert.equal(employeeItemTabFromParam("maintenance"), "maintenance");
  assert.equal(employeeItemTabFromParam("unknown"), "active");
  assert.equal(employeeItemTabFromParam(["maintenance"]), "active");
});

test("inventory-list entry points wire durable navigation state", async () => {
  const [
    page,
    table,
    employeeTabs,
    details,
    backLink,
    itemPage,
    localBarcodePage,
    summary,
    decommissioned,
    tmcFlow,
  ] = await Promise.all([
    readFile(new URL("../app/(protected)/items/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ItemsTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/EmployeeItemsTabs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/InventoryItemDetails.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/InventoryItemBackLink.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(protected)/items/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(protected)/local-barcodes/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/InventorySummaryAccordions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/DecommissionedItemsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/TmcItemQrFlow.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /searchParams: Promise<InventorySearchParams>/);
  assert.match(page, /parseInventoryTableViewState\(resolvedSearchParams\)/);
  assert.match(page, /initialViewState=\{initialViewState\}/);
  assert.match(page, /stateUrlPath="\/items"/);
  assert.match(table, /window\.history\.replaceState\(null/);
  assert.match(employeeTabs, /window\.history\.replaceState\(null/);
  assert.doesNotMatch(
    `${table}\n${employeeTabs}`,
    /replaceState\(window\.history\.state/,
  );
  assert.match(table, /inventoryDetailsHref\(itemPath, returnHref\)/);
  assert.match(details, /router\.replace\(returnDestination\)/);
  assert.match(details, /<InventoryItemBackLink href=\{returnDestination\}/);
  assert.match(backLink, /href=\{href\}[\s\S]*replace/);
  assert.match(backLink, /h-11 w-11[\s\S]*sm:w-auto/);
  assert.match(itemPage, /canonicalInventoryDetailsReturnHref/);
  assert.match(itemPage, /canAccessPath\(user\.role, requestedReturnHref\)/);
  assert.match(itemPage, /returnHref=\{returnHref\}/);
  assert.match(localBarcodePage, /canonicalInventoryDetailsReturnHref/);
  assert.match(localBarcodePage, /returnHref=\{returnHref\}/);
  assert.match(summary, /inventoryDetailsHref\(itemPath, returnHref\)/);
  assert.match(decommissioned, /itemReturnHref="\/items\/decommissioned"/);
  assert.match(tmcFlow, /itemReturnHref=\{operation\.href\}/);
});
