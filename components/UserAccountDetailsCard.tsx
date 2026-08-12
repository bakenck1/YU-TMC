import { CalendarDays, Fingerprint, Mail, Phone, UserRoundCheck } from "lucide-react";
import type { UserDto } from "@/lib/contracts/users";
import UserProfileDetail from "./UserProfileDetail";

export default function UserAccountDetailsCard({ profile }: { profile: UserDto }) {
  return (
    <section className="rounded-[1.75rem] border border-black/5 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#06458a]"><UserRoundCheck className="h-5 w-5" aria-hidden="true" /></div>
        <div><h2 className="text-lg font-bold text-zinc-900">Данные учётной записи</h2><p className="text-sm text-zinc-500">Основная контактная информация</p></div>
      </div>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <UserProfileDetail icon={Mail} label="Email" value={profile.email} />
        <UserProfileDetail icon={Phone} label="Телефон" value={profile.phone ?? "Не указан"} />
        <UserProfileDetail icon={Fingerprint} label="Код пользователя" value={profile.code} valueFormat="code" />
        <UserProfileDetail icon={CalendarDays} label="Дата добавления" value={new Date(profile.addedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })} />
      </dl>
    </section>
  );
}
