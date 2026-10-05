/** Human inventory responses disclose 1C codes only to administrators. */
export function inventoryOneCFields(
  record: { oneCCode?: string | null; searchIdentifiers?: readonly string[]; searchIdentifiersWithoutCodes?: readonly string[] },
  role: string,
): { oneCCode?: string | null; searchIdentifiers: string[] } {
  return role === "admin"
    ? { oneCCode: record.oneCCode ?? null, searchIdentifiers: [...(record.searchIdentifiers ?? [])] }
    : { searchIdentifiers: [...(record.searchIdentifiersWithoutCodes ?? [])] };
}
