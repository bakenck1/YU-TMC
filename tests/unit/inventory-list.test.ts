import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { items } from "@/lib/data";
import {
  filterInventoryItems,
  paginateInventoryItems,
  visibleItemStatus,
} from "@/lib/inventory-list";
import type { InventoryItem } from "@/lib/types";

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "base",
    name: "Monitor Alpha",
    inventoryNumber: "INV-001",
    qrCode: "QR-ALPHA",
    category: "Computers" as InventoryItem["category"],
    location: "Room A",
    responsible: "Ada",
    status: "active",
    photoColor: "#10b981",
    quantity: 1,
    price: 0,
    ...overrides,
  };
}

const allFilters = {
  query: "",
  category: "all",
  location: "all",
  statusKey: "all",
};

describe("inventory list model", () => {
  it("keeps display and lifecycle status namespaces collision-safe", () => {
    expect(visibleItemStatus(item({ displayStatus: "active" }))).toEqual({
      key: "display:active",
      kind: "display",
      value: "active",
    });
    expect(visibleItemStatus(item({ displayStatus: undefined, status: "active" }))).toEqual({
      key: "lifecycle:active",
      kind: "lifecycle",
      value: "active",
    });
  });

  it.each([
    ["  mOnItOr ALPHA ", "name"],
    [" inv-001 ", "inventory number"],
    [" qr-alpha ", "QR code"],
  ])("finds a row by normalized %s search", (query) => {
    const result = filterInventoryItems(
      [item({ id: "match" }), item({ id: "other", name: "Printer", inventoryNumber: "INV-002", qrCode: "QR-BETA" })],
      { ...allFilters, query },
    );
    expect(result.map((entry) => entry.id)).toEqual(["match"]);
  });

  it("combines category, location and visible-status filters with AND semantics", () => {
    const fixture = [
      item({ id: "match", displayStatus: "Assigned" }),
      item({ id: "wrong-category", category: "Furniture" as InventoryItem["category"], displayStatus: "Assigned" }),
      item({ id: "wrong-location", location: "Room B", displayStatus: "Assigned" }),
      item({ id: "wrong-status", displayStatus: "Marked" }),
      item({ id: "lifecycle", displayStatus: undefined, status: "active" }),
    ];
    expect(
      filterInventoryItems(fixture, {
        query: "",
        category: "Computers",
        location: "Room A",
        statusKey: "display:Assigned",
      }).map((entry) => entry.id),
    ).toEqual(["match"]);
    expect(
      filterInventoryItems(fixture, {
        ...allFilters,
        statusKey: "lifecycle:active",
      }).map((entry) => entry.id),
    ).toEqual(["lifecycle"]);
  });

  it("derives exact, partial, empty and clamped pages", () => {
    expect(paginateInventoryItems([], 7, 10)).toEqual({
      page: 1,
      pageCount: 1,
      pageItems: [],
      from: 0,
      to: 0,
      total: 0,
    });
    expect(paginateInventoryItems(Array.from({ length: 10 }, (_, index) => index), 1, 10)).toMatchObject({
      page: 1,
      pageCount: 1,
      from: 1,
      to: 10,
      total: 10,
    });
    const last = paginateInventoryItems(Array.from({ length: 23 }, (_, index) => index), 99, 10);
    expect(last).toMatchObject({ page: 3, pageCount: 3, from: 21, to: 23, total: 23 });
    expect(last.pageItems).toEqual([20, 21, 22]);
    expect(() => paginateInventoryItems([], 1, 0)).toThrow(/page size/i);
  });
});

describe("production inventory data contract", () => {
  it("has unique detail-addressable IDs and valid business values", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((entry) => entry.id)).size).toBe(items.length);
    for (const entry of items) {
      expect(entry.id).not.toBe("");
      expect(encodeURIComponent(entry.id)).toBe(entry.id);
      expect(entry.name.trim()).not.toBe("");
      expect(entry.inventoryNumber.trim()).not.toBe("");
      expect(entry.location.trim()).not.toBe("");
      expect(Number.isInteger(entry.quantity ?? 1)).toBe(true);
      expect(entry.quantity ?? 1).toBeGreaterThan(0);
      expect(Number.isFinite(entry.price ?? 0)).toBe(true);
      expect(entry.price ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("resolves every declared photo to a non-empty public asset", async () => {
    const declaredPhotos = items.flatMap((entry) => (entry.photo ? [entry.photo] : []));
    expect(declaredPhotos.length).toBeGreaterThan(0);
    for (const photo of declaredPhotos) {
      expect(photo.startsWith("/items/")).toBe(true);
      const metadata = await stat(
        path.join(process.cwd(), "public", photo.replace(/^\//, "")),
      );
      expect(metadata.isFile(), photo).toBe(true);
      expect(metadata.size, photo).toBeGreaterThan(0);
      const bytes = await readFile(path.join(process.cwd(), "public", photo.replace(/^\//, "")));
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg =
        bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes.at(-2) === 0xff &&
        bytes.at(-1) === 0xd9;
      expect(isPng || isJpeg, `${photo} must have a valid PNG or JPEG signature`).toBe(true);
    }
  });
});
