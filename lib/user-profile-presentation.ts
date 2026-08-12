import type { UserRole } from "./types";

export const USER_PROFILE_ROLE_COPY: Record<UserRole, { label: string; description: string }> = {
  admin: {
    label: "Администратор",
    description: "Полный контроль инвентаря и пользователей",
  },
  warehouse: {
    label: "Кладовщик",
    description: "Учёт, аналитика и контроль движения ТМЦ",
  },
  employee: {
    label: "Сотрудник",
    description: "Персональные ТМЦ и запросы на передачу",
  },
};

export function getProfileInitials(fullName: string, email: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return (initials || email.slice(0, 2)).toLocaleUpperCase("ru-RU");
}
