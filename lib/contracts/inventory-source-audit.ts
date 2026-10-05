/** Live record counts compared with the immutable rows saved by one dry-run. */
export type InventoryAuditInventoryState = {
  currentTotal: number;
  currentActive: number;
  currentQuantity: number;
  currentActiveQuantity: number;
  added: number;
  removed: number;
  changed: number;
  linksChanged?: boolean;
  stale: boolean;
};
