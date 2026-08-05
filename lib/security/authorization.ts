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
  ["/profile", "legacy.dashboard.read"],
  ["/users", "legacy.users.read"],
  ["/items", "legacy.items.read"],
  ["/transfers", "inventory.transfer.request_self"],
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
    // Inspections are an administrator-only workflow. In particular,
    // warehouse access is intentionally read-only for inventory and must not
    // expose this route (or its mutation endpoints).
    return hasPermission(role, "inventory.inspection.read_all");
  }
  if (matchesRoute(pathOnly, "/inventory") && role === "warehouse") {
    // The warehouse role is read-only over inventory items and must not enter
    // the building/room management workspace.
    return false;
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
