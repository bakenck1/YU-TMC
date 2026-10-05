import { inventoryNumberComparisonKey } from "@/lib/domain/code39";

export type ExcelInventoryReference = { inventoryNumber: string; sourceInventoryNumber?: string; numberIsUnmarked?: boolean };

const AUDIT_DASHES = /[\u2010-\u2015\u2212]/gu;

// These relaxed rules belong to the read-only audit, not to 1C publication.
export function inventoryAuditNumberKey(value: string): string {
  const number = value.trim().replace(/^(?:№|(?:инв(?:ентарный)?\.?(?:\s+номер)?\s*(?:№|No\.?|N\.?)?|No\.?|N\.?))\s*(?=\d)/iu, "");
  return inventoryNumberComparisonKey(number).replace(AUDIT_DASHES, "-").replace(/\s*([/-])\s*/gu, "$1");
}

export function inventoryAuditSlashlessKey(value: string): string {
  return inventoryAuditNumberKey(value).replaceAll("/", "");
}

/** A complete numeric identity with only its internal whitespace removed. */
export function inventoryAuditSpacelessKey(value: string): string | null {
  const key = inventoryAuditNumberKey(value);
  if (!/^\d+(?:(?:\s+|[/-])\d+)*$/u.test(key)) return null;
  return key.replace(/\s/gu, "");
}

/** A narrow, reviewable suffix candidate, never an exact identity or a group member. */
export function inventoryAuditSuffixStem(value: string): string | null {
  return inventoryAuditNumberKey(value).match(/^(\d{2,6}-\d{5,12})-\d{2}$/u)?.[1] ?? null;
}

function reference(token: string, unmarked: boolean): ExcelInventoryReference {
  const sourceNumber = token.normalize("NFKC").trim();
  const inventoryNumber = /^\d+\s*\/\s*\d+\s*-\s*\d+$/u.test(sourceNumber) ? sourceNumber.replace(/\s*-\s*\d+$/u, "") : sourceNumber;
  return { inventoryNumber, ...(sourceNumber !== inventoryNumber ? { sourceInventoryNumber: sourceNumber } : {}), ...(unmarked ? { numberIsUnmarked: true } : {}) };
}

/** Searches every complete number token, preserving ranges without expanding their members. */
export function extractExcelInventoryReferences(value: string): ExcelInventoryReference[] {
  // Normalize punctuation only in the search view; evidence keeps the original text.
  const searchValue = value.replace(AUDIT_DASHES, "-");
  const annotation = String.raw`(?:этаж|шт(?:ук)?|кг|мм|см|метр)(?![\p{L}\p{N}])`;
  const spacedDigits = String.raw`\s+[0-9]+(?![0-9.]|\s+${annotation})`;
  const date = String.raw`(?:0?[1-9]|[12][0-9]|3[01])\.(?:0?[1-9]|1[0-2])\.[0-9]{2}(?:[0-9]{2})?(?![\p{L}\p{N}.])`;
  // A following digit fragment remains part of the token even if a suffix or
  // decimal point prevents accepting it. Dates and explicit units end it.
  const adjacentNumericPart = String.raw`\s+(?!${date})[0-9]+(?![0-9]|\s+${annotation})`;
  const markedPattern = new RegExp(String.raw`(?:№|(?<![\p{L}\p{N}])(?:инв(?:ентарный)?\.?(?:\s+номер)?\s*(?:№|No\.?|N\.?)?|No\.?|N\.?))\s*([0-9]+(?:\s*[/-]\s*[0-9]+|${spacedDigits})*)(?![\p{L}\p{N}/-]|\.\d|\s*[/-]\s*\d|${adjacentNumericPart})`, "giu");
  const marked = [...searchValue.matchAll(markedPattern)];
  const references = marked.map((match) => reference(value.slice(match.index + match[0].length - match[1].length, match.index + match[0].length), false));
  // A plain number can be an inventory number or a model. Keep it as reviewable evidence.
  // Short quantities, years, dates, parts of models and fragments of slash lists are excluded.
  const numberPart = String.raw`[0-9]+(?:${spacedDigits})*`;
  const unmarkedPattern = new RegExp(String.raw`(?<![\p{L}\p{N}/.\-]|[/-]\s*|\d\s+)(${numberPart}(?:\s*\/\s*${numberPart})?(?:\s*-\s*${numberPart})*)(?![\p{L}\p{N}/-]|\.\d|\s*[/-]\s*\d|${adjacentNumericPart})`, "giu");
  for (const match of searchValue.matchAll(unmarkedPattern)) {
    if (marked.some((entry) => match.index >= entry.index && match.index < entry.index + entry[0].length)) continue;
    const token = match[1];
    // Unmarked short neighbouring fragments can be dates or quantities. Never
    // reinterpret a trailing piece of that sequence as a separate identifier.
    const key = inventoryAuditNumberKey(token);
    if (/\s/u.test(key) && key.split(/\s+/u).some((part) => !/\d{3}/u.test(part))) continue;
    const compact = token.replace(/\s/gu, "");
    if (/^(?:\d{4}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])-(?:0?[1-9]|1[0-2])-\d{2}(?:\d{2})?)$/u.test(compact)) continue;
    const digits = token.replace(/\D/gu, "").length;
    if (digits < (token.includes("/") ? 6 : 5) || digits > 64) continue;
    references.push(reference(value.slice(match.index, match.index + match[1].length), true));
  }
  const unique = new Map<string, ExcelInventoryReference>();
  for (const entry of references) {
    const key = inventoryAuditNumberKey(entry.sourceInventoryNumber ?? entry.inventoryNumber);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

export function extractExcelInventoryReference(value: string): ExcelInventoryReference | null {
  return extractExcelInventoryReferences(value)[0] ?? null;
}

export function extractExcelInventoryNumber(value: string): string | null {
  return extractExcelInventoryReference(value)?.inventoryNumber ?? null;
}
