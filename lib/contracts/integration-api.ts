export const INTEGRATION_ENTITIES = [
  "items", "employees", "buildings", "rooms", "responsibilities", "assignments",
  "transfers", "transfer-requests", "transfer-request-items", "service-requests", "inspections",
] as const;

export type IntegrationEntity = (typeof INTEGRATION_ENTITIES)[number];
export type IntegrationRecord = { id: string } & Record<string, unknown>;
export interface IntegrationChange {
  cursor: string;
  /** Latest committed journal revision of this record, decimal string. */
  revision: string;
  entity: IntegrationEntity;
  operation: "upsert" | "delete";
  recordId: string;
  data: IntegrationRecord | null;
  occurredAt: string;
}
export interface IntegrationChangePage {
  changes: IntegrationChange[];
  nextCursor: string;
  hasMore: boolean;
}
export interface IntegrationRepository {
  checkpoint(): Promise<string>;
  list(entity: IntegrationEntity, after: string | null, limit: number): Promise<IntegrationRecord[]>;
  changes(after: string, limit: number): Promise<IntegrationChangePage>;
}
