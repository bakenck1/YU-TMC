import type { ItemStatus } from "@/lib/contracts/inventory-domain";

/** Lifecycle states that may change responsible person. */
export function isInventoryTransferAllowed(status: ItemStatus): boolean {
  return status === "active" ||
    status === "maintenance" ||
    status === "decommissioned_in_use";
}

/** Also rejects corrupt/stale archival state without blocking the in-use status. */
export function isInventoryTransferStateAllowed(
  status: ItemStatus,
  archivedAt: Date | string | null | undefined,
): boolean {
  return isInventoryTransferAllowed(status) &&
    (status === "decommissioned_in_use" || archivedAt == null);
}
