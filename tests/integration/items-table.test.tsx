// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemsTable from "@/components/ItemsTable";
import { translate } from "@/lib/i18n";
import type { InventoryItem } from "@/lib/types";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", props),
}));
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const imageProps = { ...props };
    delete imageProps.fill;
    return React.createElement("img", imageProps);
  },
}));
vi.mock("@/components/AppSettingsProvider", async () => {
  const i18n = await import("@/lib/i18n");
  return {
    useAppSettings: () => ({
      t: (key: Parameters<typeof i18n.translate>[1], params?: Parameters<typeof i18n.translate>[2]) =>
        i18n.translate("kk", key, params),
      dataLabel: (label: string) => i18n.translateDataLabel("kk", label),
    }),
  };
});

const categoryA = "Computers" as InventoryItem["category"];
const categoryB = "Furniture" as InventoryItem["category"];

const fixture: InventoryItem[] = Array.from({ length: 23 }, (_, index) => {
  const number = index + 1;
  return {
    id: String(number),
    name: `Asset ${String(number).padStart(2, "0")}`,
    inventoryNumber: `INV-${String(number).padStart(2, "0")}`,
    qrCode: number === 5 ? "ONLY-QR-MATCH" : `QR-${number}`,
    category: number <= 12 ? categoryA : categoryB,
    location: number % 2 === 1 ? "Room A" : "Room B",
    responsible: `Person ${number}`,
    status: number === 23 ? "maintenance" : "active",
    displayStatus: number <= 12 ? "Assigned" : number <= 22 ? "Marked" : undefined,
    photoColor: "#10b981",
    photo: number === 1 ? "/items/monitor-1.png" : undefined,
    quantity: 1,
    price: number,
  };
});

const label = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("kk", key, params);

function tableRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

function expectRowItem(row: HTMLElement, name: string) {
  expect(
    within(row).getByRole("checkbox", {
      name: label("items.selectOne", { name }),
    }),
  ).toBeInTheDocument();
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("ItemsTable", () => {
  it("renders stable ten-row pages with honest ranges and boundaries", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    expect(tableRows()).toHaveLength(10);
    expectRowItem(tableRows()[0], "Asset 01");
    expectRowItem(tableRows()[9], "Asset 10");
    expect(screen.getByText(label("items.range", { from: 1, to: 10, total: 23 }))).toBeVisible();
    expect(screen.getByRole("button", { name: label("common.previous") })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: label("common.next") }));
    expectRowItem(tableRows()[0], "Asset 11");
    await user.click(screen.getByRole("button", { name: label("common.next") }));
    expect(tableRows()).toHaveLength(3);
    expectRowItem(tableRows()[2], "Asset 23");
    expect(screen.getByText(label("items.range", { from: 21, to: 23, total: 23 }))).toBeVisible();
    expect(screen.getByRole("button", { name: label("common.next") })).toBeDisabled();
  });

  it("searches normalized names and QR codes and renders an empty state", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    const search = screen.getByRole("textbox", { name: label("common.search") });
    await user.type(search, "  aSsEt 03  ");
    expect(tableRows()).toHaveLength(1);
    expectRowItem(tableRows()[0], "Asset 03");

    await user.clear(search);
    await user.type(search, "only-qr-match");
    expect(tableRows()).toHaveLength(1);
    expectRowItem(tableRows()[0], "Asset 05");

    await user.clear(search);
    await user.type(search, "does-not-exist");
    expect(within(screen.getByRole("table")).getByText(label("items.empty"))).toBeVisible();
    expect(screen.getByText(label("items.range", { from: 0, to: 0, total: 0 }))).toBeVisible();
  });

  it("combines category, location and visible custom status filters", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allCategories") }),
      categoryA,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allLocations") }),
      "Room A",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allStatuses") }),
      "display:Assigned",
    );
    expect(tableRows()).toHaveLength(6);
    ["Asset 01", "Asset 03", "Asset 05", "Asset 07", "Asset 09", "Asset 11"].forEach(
      (name, index) => expectRowItem(tableRows()[index], name),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allCategories") }),
      "all",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allLocations") }),
      "all",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: label("items.allStatuses") }),
      "lifecycle:maintenance",
    );
    expect(tableRows()).toHaveLength(1);
    expectRowItem(tableRows()[0], "Asset 23");
    expect(tableRows()[0]).toHaveTextContent(label("status.maintenance"));
  });

  it.each([
    ["query", "Asset"],
    ["category", categoryA],
    ["location", "Room A"],
    ["status", "display:Assigned"],
  ] as const)("resets page three when %s changes", async (criterion, value) => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    const next = screen.getByRole("button", { name: label("common.next") });
    await user.click(next);
    await user.click(next);
    expect(screen.getByText(label("items.range", { from: 21, to: 23, total: 23 }))).toBeVisible();

    if (criterion === "query") {
      await user.type(screen.getByRole("textbox", { name: label("common.search") }), value);
    } else {
      const key =
        criterion === "category"
          ? "items.allCategories"
          : criterion === "location"
            ? "items.allLocations"
            : "items.allStatuses";
      await user.selectOptions(screen.getByRole("combobox", { name: label(key) }), value);
    }
    expectRowItem(tableRows()[0], "Asset 01");
  });

  it("keeps selection across pages while select-all affects only the visible page", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    const table = screen.getByRole("table");
    const first = within(table).getByRole("checkbox", {
      name: label("items.selectOne", { name: "Asset 01" }),
    });
    await user.click(first);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(label("items.selected", { count: 1 }))).toBeVisible();
    const selectAll = within(table).getByRole("checkbox", { name: label("items.selectAll") });
    expect(selectAll).toHaveAttribute("aria-checked", "mixed");
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);

    await user.click(screen.getByRole("button", { name: label("common.next") }));
    expect(selectAll).toHaveAttribute("aria-checked", "false");
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);
    await user.click(within(table).getByRole("checkbox", { name: label("items.selectAll") }));
    expect(within(table).getByRole("checkbox", { name: label("items.selectAll") })).toBeChecked();
    expect(screen.getByText(label("items.selected", { count: 11 }))).toBeVisible();
    await user.click(within(table).getByRole("checkbox", { name: label("items.selectAll") }));
    expect(screen.getByText(label("items.selected", { count: 1 }))).toBeVisible();
    await user.click(screen.getByRole("button", { name: label("common.previous") }));
    expect(
      within(table).getByRole("checkbox", {
        name: label("items.selectOne", { name: "Asset 01" }),
      }),
    ).toBeChecked();
  });

  it("shares visible status and selection between desktop rows and mobile cards", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    const row = tableRows()[0];
    const card = screen.getAllByRole("article")[0];
    expect(row).toHaveTextContent("Assigned");
    expect(card).toHaveTextContent("Assigned");
    const desktopCheckbox = within(row).getByRole("checkbox");
    const mobileCheckbox = within(card).getByRole("checkbox");
    await user.click(desktopCheckbox);
    expect(mobileCheckbox).toBeChecked();
    expect(within(row).getByRole("img")).toHaveAttribute("src", "/items/monitor-1.png");
    expect(within(tableRows()[1]).queryByRole("img")).toBeNull();
  });

  it("navigates rows in the same app router but never from their checkboxes", async () => {
    const user = userEvent.setup();
    render(<ItemsTable items={fixture} />);
    const row = tableRows()[0];
    const card = screen.getAllByRole("article")[0];
    expect(within(row).getByRole("link", { name: "Asset 01 — INV-01" })).toHaveAttribute("href", "/items/1");
    await user.click(within(row).getByRole("checkbox"));
    expect(push).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("checkbox"));
    expect(push).not.toHaveBeenCalled();
    await user.click(within(card).getByText("Room A"));
    expect(push).toHaveBeenCalledWith("/items/1");
    push.mockClear();
    await user.click(row);
    expect(push).toHaveBeenCalledWith("/items/1");
  });
});
