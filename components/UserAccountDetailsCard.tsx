import { CalendarDays, Fingerprint, Mail, Phone, UserRoundCheck } from "lucide-react";
import type { UserDto } from "@/lib/contracts/users";
import { useAppSettings } from "@/components/AppSettingsProvider";
import UserProfileDetail from "./UserProfileDetail";

export default function UserAccountDetailsCard({ profile }: { profile: UserDto }) {
  const { locale, t } = useAppSettings();
  return (
    <section className="rounded-[1.75rem] border border-black/5 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#06458a]"><UserRoundCheck className="h-5 w-5" aria-hidden="true" /></div>
        <div><h2 className="text-lg font-bold text-zinc-900">{t("profile.accountTitle")}</h2><p className="text-sm text-zinc-500">{t("profile.accountSubtitle")}</p></div>
      </div>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <UserProfileDetail icon={Mail} label={t("auth.email")} value={profile.email} />
        <UserProfileDetail icon={Phone} label={t("users.phone")} value={profile.phone ?? t("common.notSpecified")} />
        <UserProfileDetail icon={Fingerprint} label={t("users.code")} value={profile.code} valueFormat="code" />
        <UserProfileDetail icon={CalendarDays} label={t("users.addedAt")} value={new Date(profile.addedAt).toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" })} />
      </dl>
    </section>
  );
}
