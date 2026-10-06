
import { isEmployeeRole } from "@/lib/contracts/users";
import type { UserRole } from "@/lib/contracts/users";

/** Roles that may own inventory responsibility periods. */
export function isInventoryResponsibleRole(role: UserRole): boolean {
  return isEmployeeRole(role) || role === "warehouse" || role === "admin";
}
