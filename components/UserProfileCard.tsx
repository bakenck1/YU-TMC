import {
  BadgeCheck,
  CalendarDays,
  Fingerprint,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";

import type { UserDto } from "@/lib/contracts/users";

const ROLE_PRESENTATION: Record<
  UserDto["role"],
  { label: string; description: string; badgeClass: string; iconClass: string }
> = {
  admin: {
    label: "Администратор",
    description: "Полный контроль инвентаря и пользователей",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
    iconClass: "bg-violet-100 text-violet-700",
  },
  warehouse: {
    label: "Кладовщик",
    description: "Учёт, аналитика и контроль движения ТМЦ",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    iconClass: "bg-amber-100 text-amber-700",
  },
  employee: {
    label: "Сотрудник",
    description: "Персональные ТМЦ и запросы на передачу",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
};

export default function UserProfileCard({ profile }: { profile: UserDto }) {
  const role = ROLE_PRESENTATION[profile.role];

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-label="Профиль пользователя">
      <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#001a4d] via-[#06458a] to-emerald-500 p-6 text-white shadow-xl shadow-blue-950/15 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-emerald-300/15 blur-2xl" />
        <Sparkles className="pointer-events-none absolute right-8 top-8 h-7 w-7 text-white/40" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.75rem] border border-white/25 bg-white/15 text-3xl font-bold tracking-wide shadow-inner backdrop-blur-md sm:h-28 sm:w-28 sm:text-4xl">
            {profileInitials(profile.fullName, profile.email)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-50 backdrop-blur">
                Профиль
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/20 px-3 py-1 text-xs font-semibold text-emerald-50">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                {profile.active ? "Активный аккаунт" : "Аккаунт неактивен"}
              </span>
            </div>
            <h1 className="mt-4 break-words text-3xl font-bold tracking-tight sm:text-4xl">
              {profile.fullName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100 sm:text-base">
              {role.description}
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/10 px-4 py-3 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.18em] text-blue-100">ID профиля</p>
            <p className="mt-1 font-mono text-sm font-semibold text-white">{profile.code}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[1.75rem] border border-black/5 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#06458a]">
              <UserRoundCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Данные учётной записи</h2>
              <p className="text-sm text-zinc-500">Основная контактная информация</p>
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <ProfileDetail icon={Mail} label="Email" value={profile.email} />
            <ProfileDetail icon={Phone} label="Телефон" value={profile.phone ?? "Не указан"} />
            <ProfileDetail icon={Fingerprint} label="Код пользователя" value={profile.code} mono />
            <ProfileDetail
              icon={CalendarDays}
              label="Дата добавления"
              value={new Date(profile.addedAt).toLocaleDateString("ru-RU", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            />
          </dl>
        </section>

        <aside className="space-y-4">
          <section className="rounded-[1.75rem] border border-black/5 bg-white p-5 shadow-sm">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${role.iconClass}`}>
              <ShieldCheck className="h-6 w-6" />
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Ваша роль</p>
            <div className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-sm font-bold ${role.badgeClass}`}>
              {role.label}
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-500">{role.description}</p>
          </section>

          <section className="rounded-[1.75rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                {profile.emailVerified ? <BadgeCheck className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="font-bold text-zinc-900">
                  {profile.emailVerified ? "Email подтверждён" : "Email не подтверждён"}
                </h2>
                <p className="mt-1 text-sm leading-5 text-zinc-500">
                  {profile.emailVerified
                    ? "Адрес проверен и может использоваться для входа."
                    : "Обратитесь к администратору для проверки адреса."}
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function ProfileDetail({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="group rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 transition-colors hover:border-blue-100 hover:bg-blue-50/40">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
        <Icon className="h-4 w-4 text-zinc-400 transition-colors group-hover:text-[#06458a]" />
        {label}
      </dt>
      <dd className={`mt-3 break-words text-sm font-semibold text-zinc-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function profileInitials(fullName: string, email: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return (initials || email.slice(0, 2)).toLocaleUpperCase("ru-RU");
}
