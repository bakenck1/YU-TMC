import { Check } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import Badge from "./Badge";

export default function UserVerificationBadge({ verified }: { verified: boolean }) {
  const { t } = useAppSettings();
  return (
    <Badge tone={verified ? "success" : "danger"} shape="soft" size="sm" icon={verified ? Check : undefined}>
      {verified ? t("users.verified") : t("users.unverified")}
    </Badge>
  );
}
