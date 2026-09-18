export type SharedInventoryNumberDevice = "monitor" | "system_unit";

export function sharedInventoryNumberDevice(
  value: unknown,
): SharedInventoryNumberDevice | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ");
  if (/^(монитор|monitor)(?:\s|$)/u.test(normalized)) return "monitor";
  if (/^(системный блок|system unit|жүйелік блок)(?:\s|$)/u.test(normalized)) {
    return "system_unit";
  }
  return null;
}

export function needsUniqueItemBarcode(name: unknown): boolean {
  return sharedInventoryNumberDevice(name) !== null;
}
