import {
  USER_ROLES,
  type UserRole,
} from "@/lib/contracts/users";
import {
  hasPermission,
  type AppPermission,
} from "@/lib/security/permissions";

export const AUTH_ROLES = USER_ROLES;

export type AuthRole = UserRole;

export interface AuthenticatedUser {
  email: string;
  name: string;
  role: AuthRole;
}

export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === "string" && AUTH_ROLES.includes(value as AuthRole);
}

const ROUTE_PERMISSIONS = [
  ["/inventory", "inventory.workspace.read"],
  ["/analytics", "legacy.analytics.read"],
  ["/locations", "legacy.locations.read"],
  ["/settings", "legacy.settings.manage"],
  ["/users", "legacy.users.read"],
  ["/items", "legacy.items.read"],
  ["/", "legacy.dashboard.read"],
] as const satisfies readonly (readonly [string, AppPermission])[];

function matchesRoute(pathname: string, route: string) {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function permissionForPath(pathname: string): AppPermission | null {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  return (
    ROUTE_PERMISSIONS.find(([route]) => matchesRoute(pathOnly, route))?.[1] ??
    null
  );
}

export function canAccessPath(role: unknown, pathname: string) {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  if (matchesRoute(pathOnly, "/inventory/inspections")) {
    return (
      hasPermission(role, "inventory.inspection.read_all") ||
      hasPermission(role, "inventory.inspection.read_own")
    );
  }
  if (matchesRoute(pathOnly, "/items/decommissioned")) {
    return hasPermission(role, "inventory.item.read_all");
  }
  const permission = permissionForPath(pathname);
  return permission !== null && hasPermission(role, permission);
}

export function defaultPathForRole(role: AuthRole) {
  return role === "employee" ? "/items" : "/";
}

export function isSafeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false;

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
      return false;
    }
    const base = "https://yu-inventory.test";
    return new URL(value, base).origin === base;
  } catch {
    return false;
  }
}
