import { Sparkles } from "lucide-react";
import type { UserDto } from "@/lib/contracts/users";
import { getProfileInitials, USER_PROFILE_ROLE_COPY } from "@/lib/user-profile-presentation";

export default function UserProfileHeader({ profile }: { profile: UserDto }) {
  const role = USER_PROFILE_ROLE_COPY[profile.role];
  return (
    <header className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#001a4d] via-[#06458a] to-emerald-500 p-6 text-white shadow-xl shadow-blue-950/15 sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[36px] border-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-52 w-52 rounded-full bg-emerald-300/15 blur-2xl" aria-hidden="true" />
      <Sparkles className="pointer-events-none absolute right-8 top-8 h-7 w-7 text-white/40" aria-hidden="true" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.75rem] border border-white/25 bg-white/15 text-3xl font-bold tracking-wide shadow-inner backdrop-blur-md sm:h-28 sm:w-28 sm:text-4xl">
          {getProfileInitials(profile.fullName, profile.email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-50 backdrop-blur">Профиль</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/20 px-3 py-1 text-xs font-semibold text-emerald-50">
              <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" />
              {profile.active ? "Активный аккаунт" : "Аккаунт неактивен"}
            </span>
          </div>
          <h1 className="mt-4 break-words text-3xl font-bold tracking-tight sm:text-4xl">{profile.fullName}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100 sm:text-base">{role.description}</p>
        </div>
        <div className="rounded-2xl border border-white/15 bg-black/10 px-4 py-3 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-blue-100">ID профиля</p>
          <p className="mt-1 font-mono text-sm font-semibold text-white">{profile.code}</p>
        </div>
      </div>
    </header>
  );
}
