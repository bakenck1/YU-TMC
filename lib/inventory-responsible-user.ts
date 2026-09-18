import type { UserRole } from "@/lib/contracts/users";

/** Roles that may own inventory responsibility periods. */
export function isInventoryResponsibleRole(role: UserRole): boolean {
  return role === "employee" || role === "warehouse" || role === "admin";
}
