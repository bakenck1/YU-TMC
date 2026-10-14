import type { AuditMatch } from "@/lib/inventory-source-audit";

// Shared by the review UI and server audit without loading the server matcher.
export const INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION = 7;

export function auditNeedsReview(row: AuditMatch): boolean {
  const reasons = [...row.oneC.flatMap((entry) => entry.matchedBy), ...row.excel.flatMap((entry) => entry.matchedBy ?? [])];
  return reasons.length > 0 && reasons.every(isWeakEvidence);
}

export function isWeakEvidence(reason: string): boolean {
  return reason === "number_without_slash" || reason === "number_in_description" || reason === "number_format" || reason === "number_suffix" || reason === "number_spaces";
}
