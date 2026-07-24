export const AUTH_ROLES = ["admin", "owner", "warehouse", "employee"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

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
  return ROLE_ROUTES[role].some((route) => matchesRoute(pathname, route));
}

export function defaultPathForRole(role: AuthRole) {
  return role === "employee" ? "/items" : "/";
}

export function isSafeReturnPath(value: string | null | undefined) {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}
