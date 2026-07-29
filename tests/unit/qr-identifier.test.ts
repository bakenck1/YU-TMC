import { describe, expect, it } from "vitest";

import {
  parseQrIdentifierInput,
  qrIdentifierFromEntropy,
} from "@/lib/domain/qr-identifier";
import { normalizeQrTextInput } from "@/lib/domain/text-normalization";

const TOKEN = "7K3M9W2T8R5D4H6N1P0QX9C2BZ";
const PAYLOAD = `YUQ1:${TOKEN}`;

describe("QR identifier domain rules", () => {
  it("canonicalizes full and bare generated values to one registry key", () => {
    expect(parseQrIdentifierInput(PAYLOAD)).toEqual({
      ok: true,
      canonicalKey: PAYLOAD,
      format: "generated_v1",
      originalValue: PAYLOAD,
    });
    expect(parseQrIdentifierInput(TOKEN.toLowerCase())).toEqual({
      ok: true,
      canonicalKey: PAYLOAD,
      format: "generated_v1",
      originalValue: TOKEN.toLowerCase(),
    });
    expect(parseQrIdentifierInput(`\uFEFF  yuq1:${TOKEN.toLowerCase()}\r\n`))
      .toMatchObject({
        ok: true,
        canonicalKey: PAYLOAD,
        format: "generated_v1",
      });
  });

  it("preserves legacy aliases exactly after boundary filtering", () => {
    expect(parseQrIdentifierInput("  050-0002369  ")).toEqual({
      ok: true,
      canonicalKey: "050-0002369",
      format: "legacy_raw",
      originalValue: "050-0002369",
    });
    expect(parseQrIdentifierInput("2411 / 0162")).toMatchObject({
      ok: true,
      canonicalKey: "2411 / 0162",
      format: "legacy_raw",
    });
    expect(parseQrIdentifierInput("https://legacy.example/item/1")).toMatchObject(
      {
        ok: true,
        format: "legacy_url",
      },
    );
  });

  it.each([
    ["YUQ2:7K3M9W2T8R5D4H6N1P0QX9C2BZ", "UNSUPPORTED_VERSION"],
    ["YUQ1:short", "INVALID"],
    ["YUQ-broken", "INVALID"],
    ["7K3M9W2T8R5D4H6N1P0QX9C2BI", "INVALID"],
    ["-", "INVALID"],
    ["??", "INVALID"],
    ["legacy\u0000value", "INVALID"],
    ["legacy\u00A0value", "INVALID"],
  ] as const)("rejects %j as %s", (input, error) => {
    expect(parseQrIdentifierInput(input)).toEqual({ ok: false, error });
  });

  it("enforces the byte limit before interpreting the namespace", () => {
    expect(normalizeQrTextInput("x".repeat(512))).toMatchObject({ ok: true });
    expect(normalizeQrTextInput("я".repeat(257))).toEqual({
      ok: false,
      error: "TOO_LONG",
    });
  });

  it("encodes exactly 128 bits into a canonical opaque identifier", () => {
    expect(qrIdentifierFromEntropy(new Uint8Array(16))).toBe(
      `YUQ1:${"0".repeat(26)}`,
    );
    expect(qrIdentifierFromEntropy(new Uint8Array(16).fill(255))).toBe(
      `YUQ1:7${"Z".repeat(25)}`,
    );
    expect(() => qrIdentifierFromEntropy(new Uint8Array(15))).toThrow(
      RangeError,
    );
  });
});
