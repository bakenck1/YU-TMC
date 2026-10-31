/** Accounting role suffixes are metadata, never part of a person's full name. */
export function oneCResponsibleNameKey(value: string | null | undefined): string | null {
  const key = value?.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim()
    .replace(/(?:[\s,;]+(?:осн\.?\s+)?мол|\s*\(\s*(?:осн\.?\s+)?мол\s*\))$/u, "")
    .trim().replace(/\s+/gu, " ");
  return key || null;
}
