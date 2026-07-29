import { describe, expect, it } from "vitest";

import {
  cleanLegacyValue,
  legacyFloor,
  legacyInventoryNumber,
  legacyKey,
  legacyQrKey,
  usableLegacyQr,
} from "@/lib/server/seed/legacy-normalization";

describe("legacy seed normalization", () => {
  it("turns placeholder and duplicate inventory numbers into deterministic TMP values", () => {
    expect(legacyInventoryNumber("-", 0, new Set(), 2026)).toEqual({
      kind: "temporary",
      value: "TMP-2026-000001",
    });
    expect(
      legacyInventoryNumber("INV-1", 1, new Set(["inv-1"]), 2026),
    ).toEqual({
      kind: "temporary",
      value: "TMP-2026-000002",
    });
    expect(legacyInventoryNumber(" INV-1 ", 1, new Set(), 2026)).toEqual({
      kind: "official",
      value: "INV-1",
    });
  });

  it("normalizes locations and rejects unusable QR input without truncating it", () => {
    expect(cleanLegacyValue(" ?? ")).toBe("");
    expect(legacyKey("  Каб IT ")).toBe("каб it");
    expect(legacyFloor("D212")).toBe(2);
    expect(legacyFloor("A1001")).toBe(10);
    expect(legacyFloor("D050")).toBe(0);
    expect(legacyFloor("Кабинет 305")).toBe(3);
    expect(legacyFloor("Библиотека")).toBe(0);
    expect(usableLegacyQr("- ")).toBeNull();
    expect(usableLegacyQr("x".repeat(513))).toBeNull();
    expect(usableLegacyQr(" QR-1 ")).toBe("QR-1");
    expect(usableLegacyQr("\uFEFF\t2411/0162\r\n")).toBe("2411/0162");
    expect(legacyQrKey("2411/0162")).toBe("2411/0162");
    expect(usableLegacyQr("2411\u00A00162")).toBeNull();
    expect(
      usableLegacyQr("YUQ1:7K3M9W2T8R5D4H6N1P0QX9C2BZ"),
    ).toBeNull();
  });
});
