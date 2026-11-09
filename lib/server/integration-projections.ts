import "server-only";
import type { IntegrationEntity } from "@/lib/contracts/integration-api";

// Explicit allowlists shared by snapshot queries and the migration generator.
// Never serialize an entire database row: it may contain credentials or photos.
export const integrationProjections: Record<IntegrationEntity, { table: string; fields: string[] }> = {
  items: { table: "items", fields: ["id", "name", "itemType", "itemSection", "itType", "brand", "model", "quantity", "unitPrice", "roomId", "inventoryNumber", "inventoryNumberKind", "status", "condition", "isProject", "createdBy", "updatedBy", "createdAt", "updatedAt", "archivedAt", "version"] },
  employees: { table: "users", fields: ["id", "fullName", "orgUnit", "position", "role", "isActive", "updatedAt", "deletedAt", "version"] },
  buildings: { table: "buildings", fields: ["id", "name", "address", "status", "updatedAt", "archivedAt", "version"] },
  rooms: { table: "rooms", fields: ["id", "buildingId", "designation", "floorNumber", "floorLabel", "primaryResponsibleId", "status", "updatedAt", "archivedAt", "version"] },
  responsibilities: { table: "responsibility_periods", fields: ["id", "itemId", "responsibleUserId", "source", "startedAt", "startedBy", "endedAt", "endedBy"] },
  assignments: { table: "local_item_groups", fields: ["id", "itemId", "parentGroupId", "barcodeValue", "quantity", "responsibleUserId", "roomId", "previousResponsibleUserId", "previousRoomId", "createdBy", "createdAt", "transferredAt", "status", "cancelledAt", "cancelledBy", "version"] },
  transfers: { table: "transfers", fields: ["id", "itemId", "requestedBy", "proposedResponsibleId", "currentResponsibleIdAtRequest", "status", "requestedAt", "closedAt", "closedBy", "overrideOutcome", "overrideResponsibleId", "version"] },
  "transfer-requests": { table: "tmc_transfer_requests", fields: ["id", "initiatorId", "recipientId", "status", "createdAt", "expiresAt", "closedAt", "closedBy", "isAdministrativeDecision", "version"] },
  "transfer-request-items": { table: "tmc_transfer_request_items", fields: ["id", "requestId", "itemId", "currentResponsibleIdAtRequest", "responsibilityPeriodIdAtRequest", "requestedQuantity", "sourceLocalGroupId", "sourceVersion", "result", "createdAt", "decidedAt", "decidedBy", "version"] },
  "service-requests": { table: "service_requests", fields: ["id", "itemId", "roomId", "authorId", "type", "status", "createdAt", "updatedAt", "completedAt", "updatedBy", "version"] },
  inspections: { table: "inspections", fields: ["id", "name", "technicianId", "createdBy", "status", "createdAt", "updatedAt", "deadlineAt", "confirmedAt", "cancelledAt", "version"] },
};

export function snakeCase(field: string) { return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }
export function projectionSql(entity: IntegrationEntity, alias: string) {
  return `jsonb_build_object(${integrationProjections[entity].fields.map((field) =>
    `'${field}', ${alias}."${snakeCase(field)}"${field === "unitPrice" ? "::text" : ""}`,
  ).join(", ")})`;
}
