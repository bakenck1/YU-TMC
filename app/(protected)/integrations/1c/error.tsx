"use client";

export default function Error({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-3 rounded-2xl border border-red-200 bg-white p-6"><h2 className="text-lg font-semibold">Не удалось загрузить аналитику 1С</h2><p className="text-sm text-zinc-600">Проверьте доступность базы данных и повторите загрузку. Недоступные показатели не заменяются нулями.</p><button type="button" onClick={reset} className="rounded-xl bg-[#002060] px-4 py-2 text-sm text-white">Повторить загрузку</button></div>;
}
