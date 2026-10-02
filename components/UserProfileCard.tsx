"use client";

import type { UserDto } from "@/lib/contracts/users";
import type { InventoryItem } from "@/lib/types";
import InventorySummaryAccordions from "./InventorySummaryAccordions";
import UserAccountDetailsCard from "./UserAccountDetailsCard";
import UserEmailVerificationCard from "./UserEmailVerificationCard";
import UserProfileHeader from "./UserProfileHeader";
import UserProfileRoleCard from "./UserProfileRoleCard";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function UserProfileCard({
  profile,
  items,
}: {
  profile: UserDto;
  items: InventoryItem[];
}) {
  const { t } = useAppSettings();
  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-label={t("profile.userProfile")}>
      <UserProfileHeader profile={profile} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <UserAccountDetailsCard profile={profile} />
        <aside className="space-y-4">
          <UserProfileRoleCard role={profile.role} />
          <UserEmailVerificationCard verified={profile.emailVerified} />
        </aside>
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("profile.inventoryTitle")}
        </h2>
        <p className="text-sm text-zinc-500">{t("profile.inventoryHint")}</p>
        <InventorySummaryAccordions items={items} />
      </div>
    </section>
  );
}
