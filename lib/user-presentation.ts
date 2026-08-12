import type { UserRole } from "./types";
import type { TranslationKey } from "./i18n";

export const USER_ROLE_LABEL_KEYS: Record<UserRole, TranslationKey> = {
  admin: "users.admin",
  warehouse: "users.warehouse",
  employee: "users.employee",
};

export function formatUserDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function getUserInitials(fullName: string) {
  return fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
