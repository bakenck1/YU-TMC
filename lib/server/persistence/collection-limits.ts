import { ApplicationError } from "@/lib/domain/application-error";

/**
 * Hard ceilings for collection reads that can be reached from an HTTP route
 * or a server-rendered page. A caller can still use the existing filters and
 * cursor-based APIs, but an accidentally unbounded query must never turn into
 * an unbounded response or workbook build.
 */
export const COLLECTION_LIMITS = {
  users: 5_000,
  buildings: 1_000,
  roomsPerBuilding: 5_000,
  inventoryItems: 10_000,
  itemComponents: 1_000,
  itemAudit: 2_000,
  inspections: 1_000,
  inspectionRooms: 2_000,
  inspectionRows: 20_000,
  responsibilityTransfers: 5_000,
  responsibilityTimeline: 2_000,
  roomWorkspaceItems: 10_000,
  serviceRequests: 1_000,
  pushSubscriptionsPerUser: 10,
} as const;

/**
 * Ask PostgreSQL for one sentinel row. The caller can distinguish a complete
 * result from an over-budget result without fetching an unbounded collection.
 */
export function sqlCollectionLimit(limit: number): string {
  return `limit ${limit + 1}`;
}

export function assertCollectionSize<T>(
  rows: T[],
  limit: number,
  publicCode = "collection_too_large",
): T[] {
  if (rows.length > limit) {
    throw new ApplicationError("payload_too_large", publicCode);
  }
  return rows;
}
