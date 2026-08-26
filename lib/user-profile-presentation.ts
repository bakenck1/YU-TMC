import type { UserRole } from "./types";
import type { TranslationKey } from "./i18n";

export const USER_PROFILE_ROLE_COPY: Record<UserRole, { labelKey: TranslationKey; descriptionKey: TranslationKey }> = {
  admin: {
    labelKey: "users.admin",
    descriptionKey: "profile.roleAdminDescription",
  },
  warehouse: {
    labelKey: "users.warehouse",
    descriptionKey: "profile.roleWarehouseDescription",
  },
  employee: {
    labelKey: "users.employee",
    descriptionKey: "profile.roleEmployeeDescription",
  },
};

export function getProfileInitials(fullName: string, email: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return (initials || email.slice(0, 2)).toLocaleUpperCase("ru-RU");
}
