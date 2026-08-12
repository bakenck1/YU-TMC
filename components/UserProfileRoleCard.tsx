import { ShieldCheck } from "lucide-react";
import type { UserRole } from "@/lib/types";
import { USER_PROFILE_ROLE_COPY } from "@/lib/user-profile-presentation";

const ROLE_STYLES: Record<UserRole, { badge: string; icon: string }> = {
  admin: { badge: "border-violet-200 bg-violet-50 text-violet-700", icon: "bg-violet-100 text-violet-700" },
  warehouse: { badge: "border-amber-200 bg-amber-50 text-amber-700", icon: "bg-amber-100 text-amber-700" },
  employee: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: "bg-emerald-100 text-emerald-700" },
};

export default function UserProfileRoleCard({ role }: { role: UserRole }) {
  const copy = USER_PROFILE_ROLE_COPY[role];
  const styles = ROLE_STYLES[role];
  return (
    <section className="rounded-[1.75rem] border border-black/5 bg-white p-5 shadow-sm">
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${styles.icon}`}><ShieldCheck className="h-6 w-6" aria-hidden="true" /></div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Ваша роль</p>
      <div className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-sm font-bold ${styles.badge}`}>{copy.label}</div>
      <p className="mt-3 text-sm leading-6 text-zinc-500">{copy.description}</p>
    </section>
  );
}
