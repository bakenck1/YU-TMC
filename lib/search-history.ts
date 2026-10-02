import { normalizeInventorySearchText } from "./inventory-search";

export const SEARCH_HISTORY_LIMIT = 20;

export function addSearchHistoryEntry(
  history: readonly string[],
  query: string,
): string[] {
  const value = query.trim();
  if (!value) return [...history];
  const comparison = normalizeInventorySearchText(value);
  return [
    value,
    ...history.filter((entry) => normalizeInventorySearchText(entry) !== comparison),
  ].slice(0, SEARCH_HISTORY_LIMIT);
}

export function parseSearchHistory(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const history: string[] = [];
    for (const entry of parsed) {
      const value = typeof entry === "string" ? entry.trim() : "";
      if (
        value &&
        !history.some((saved) => normalizeInventorySearchText(saved) === normalizeInventorySearchText(value))
      ) {
        history.push(value);
      }
      if (history.length === SEARCH_HISTORY_LIMIT) break;
    }
    return history;
  } catch {
    return [];
  }
}

export function clearSensitiveSearchStorage(storage: Storage = window.localStorage) {
  const prefixes = [
    "yu-inventory:item-search-history:",
    "yu-inventory:item-filter-history:",
  ];
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
    }
  }
}
