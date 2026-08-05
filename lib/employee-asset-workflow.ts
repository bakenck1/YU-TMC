import type { ItemStatus } from "@/lib/contracts/inventory-domain";

export type EmployeeScanAction =
  | { kind: "claim_free" }
  | { kind: "request_transfer"; ownerName: string }
  | { kind: "already_owned" }
  | { kind: "unavailable" };

export function employeeScanAction(input: {
  status: ItemStatus;
  responsibleName?: string | null;
  isCurrentUserResponsible?: boolean;
}): EmployeeScanAction {
  if (input.status !== "active") return { kind: "unavailable" };
  if (input.isCurrentUserResponsible) return { kind: "already_owned" };
  if (!input.responsibleName) return { kind: "claim_free" };
  return { kind: "request_transfer", ownerName: input.responsibleName };
}
