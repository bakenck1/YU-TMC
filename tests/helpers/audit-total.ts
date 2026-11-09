export function auditTotal(counts: unknown): number {
  if (!counts || typeof counts !== "object" || !("total" in counts) || typeof counts.total !== "number") {
    throw new Error("Audit response must contain a numeric total");
  }
  return counts.total;
}

export function auditCount(counts: unknown, key: string): number {
  const value: unknown = counts && typeof counts === "object"
    ? Object.entries(counts).find(([name]) => name === key)?.[1]
    : undefined;
  if (typeof value !== "number") throw new Error(`Audit response must contain numeric ${key}`);
  return value;
}
