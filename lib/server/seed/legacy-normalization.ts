import "server-only";

import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";

export function cleanLegacyValue(value: string | undefined): string {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  return normalized === "-" || normalized === "??" ? "" : normalized;
}

export function legacyKey(value: string): string {
  return cleanLegacyValue(value).toLocaleLowerCase("ru-RU");
}

export function legacyQrKey(value: string): string {
  return normalizeLegacyQr(value);
}

export function legacyFloor(room: string): number {
  const normalized = cleanLegacyValue(room);
  const match =
    normalized.match(/[A-Za-zА-Яа-яЁё]?(\d{3,4})\b/u) ??
    normalized.match(/\b(\d{3,4})\b/u);
  if (!match) return 0;
  return Number(match[1].slice(0, -2));
}

export function legacyInventoryNumber(
  value: string | undefined,
  index: number,
  usedKeys: ReadonlySet<string>,
  year: number,
): { kind: "official" | "temporary"; value: string } {
  const candidate = cleanLegacyValue(value).slice(0, 64);
  if (candidate && !usedKeys.has(legacyKey(candidate))) {
    return { kind: "official", value: candidate };
  }
  return {
    kind: "temporary",
    value: `TMP-${year}-${String(index + 1).padStart(6, "0")}`,
  };
}

export function usableLegacyQr(value: string | undefined): string | null {
  const parsed = parseQrIdentifierInput(value);
  if (!parsed.ok || parsed.format === "generated_v1") return null;
  return parsed.originalValue;
}

/**
 * Legacy QR aliases are compared exactly after the input-filter boundary
 * cleanup. Delimiters, internal spaces and Unicode letters are intentionally
 * preserved; unlike display fields they must not be rewritten with NFKC.
 */
export function normalizeLegacyQr(value: string | undefined): string {
  if (typeof value !== "string") return "";
  let normalized = value;
  if (normalized.startsWith("\uFEFF")) normalized = normalized.slice(1);
  normalized = normalized.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  if (!normalized || normalized === "-" || normalized === "??") return "";
  if (
    /[\u0000-\u001F\u007F-\u009F\u00A0\u061C\u200E\u200F\u2028\u2029\u202F\u205F\u3000\uFEFF\u202A-\u202E\u2066-\u2069]/u.test(
      normalized,
    )
  ) {
    return "";
  }
  return normalized;
}
