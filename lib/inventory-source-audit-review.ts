import type { AuditMatch } from "@/lib/inventory-source-audit";

// Shared by the review UI and server audit without loading the server matcher.
export const INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION = 9;

export function auditNeedsReview(row: AuditMatch): boolean {
  // Several balances of one material are expected; different material identities are not.
  const materialIdentities = new Set(row.excel.filter(entry => entry.sourceKind === "materials_api")
    .map(entry => entry.materialGuid ?? entry.oneCCode ?? entry.sourceKey));
  if (materialIdentities.size > 1) return true;
  const reasons = [...row.oneC.flatMap((entry) => entry.matchedBy), ...row.excel.flatMap((entry) => entry.matchedBy ?? [])];
  return reasons.length > 0 && reasons.every(isWeakEvidence);
}

export function isWeakEvidence(reason: string): boolean {
  return reason === "number_without_slash" || reason === "number_in_description" || reason === "number_format" || reason === "number_suffix" || reason === "number_spaces";
}
