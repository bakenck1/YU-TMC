/** Presence in Inventory at the time of the batch's last identifier analysis. */
export type OneCInventoryPresence = "missing" | "found" | "review" | "excluded" | "pending";

export const ONE_C_PRESENCE_LABELS: Record<OneCInventoryPresence, string> = {
  missing: "Нет в Inventory",
  found: "Найдено в Inventory",
  review: "Требует проверки",
  excluded: "Исключено из сверки",
  pending: "Сверка не выполнена",
};

export function oneCInventoryPresence(row: Record<string, unknown>): OneCInventoryPresence {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  if (row.review_state === "excluded" || issues.some((issue) => issue?.code === "non_physical_asset")) return "excluded";
  if (row.review_state === "pending" || !row.match_method) return "pending";
  if (row.review_state === "conflict") return "review";
  if (row.matched_item_id || row.published_item_id) return "found";
  const payload = row.payload as Record<string, unknown> | null | undefined;
  const hasIdentifier = [payload?.inventoryNumber, payload?.code].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  const invalidBarcode = issues.some(
    (issue) => issue?.code === "invalid_one_c_barcode",
  );
  return row.match_method === "new_candidate" && payload?.status === "Принято к учёту"
    && hasIdentifier && !invalidBarcode ? "missing" : "review";
}

export function oneCMissingInventoryMessage(name: string): string {
  return /(?:шкаф|\bcloset\b|\bcabinet\b)/iu.test(name)
    ? "Осы шкаф жоқ — нет в Inventory"
    : "Осы ТМЦ жоқ — нет в Inventory";
}
