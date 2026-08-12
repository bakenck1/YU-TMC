import { BadgeCheck, Mail } from "lucide-react";

export default function UserEmailVerificationCard({ verified }: { verified: boolean }) {
  const Icon = verified ? BadgeCheck : Mail;
  return (
    <section className="rounded-[1.75rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><Icon className="h-5 w-5" aria-hidden="true" /></div>
        <div>
          <h2 className="font-bold text-zinc-900">{verified ? "Email подтверждён" : "Email не подтверждён"}</h2>
          <p className="mt-1 text-sm leading-5 text-zinc-500">{verified ? "Адрес проверен и может использоваться для входа." : "Обратитесь к администратору для проверки адреса."}</p>
        </div>
      </div>
    </section>
  );
}
