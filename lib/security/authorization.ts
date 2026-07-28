import {
  USER_ROLES,
  type UserRole,
} from "@/lib/contracts/users";

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

export function normalizeAuthRole(value: unknown): AuthRole {
  return isAuthRole(value) ? value : "admin";
}

const ROLE_ROUTES: Record<AuthRole, readonly string[]> = {
  admin: ["/"],
  owner: ["/"],
  warehouse: ["/", "/items", "/locations", "/analytics"],
  employee: ["/", "/items"],
};

function matchesRoute(pathname: string, route: string) {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function canAccessPath(role: AuthRole, pathname: string) {
  if (role === "admin" || role === "owner") return true;
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  return ROLE_ROUTES[role].some((route) => matchesRoute(pathOnly, route));
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
