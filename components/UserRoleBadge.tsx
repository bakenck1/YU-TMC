import type { UserRole } from "@/lib/types";
import { USER_ROLE_LABEL_KEYS } from "@/lib/user-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import Badge from "./Badge";

const ROLE_TONES = {
  admin: "success",
  warehouse: "info",
  employee: "neutral",
  typography: "info",
  passport_author: "neutral",
  passport_reviewer: "info",
} as const;

export default function UserRoleBadge({ role }: { role: UserRole }) {
  const { t } = useAppSettings();
  return <Badge tone={ROLE_TONES[role]}>{t(USER_ROLE_LABEL_KEYS[role])}</Badge>;
}
