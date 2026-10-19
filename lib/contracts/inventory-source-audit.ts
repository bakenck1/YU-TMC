/** Live record counts compared with the immutable rows saved by one dry-run. */
export type MaterialRegistryMetadata = {
  kind: "materials_api";
  batchId: string | null;
  receivedAt: string | null;
  snapshotAt: string | null;
  sha256: string;
  rowCount: number;
  materialCount: number;
  positiveRows: number;
  nonPositiveRows: number;
};

export type InventoryAuditInventoryState = {
  currentTotal: number;
  currentActive: number;
  currentQuantity: number;
  currentActiveQuantity: number;
  added: number;
  removed: number;
  changed: number;
  linksChanged?: boolean;
  materialSourceChanged?: boolean;
  stale: boolean;
};
