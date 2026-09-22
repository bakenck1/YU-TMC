import Link from "next/link";
import { Database, Search } from "lucide-react";

import type { OneCDecommissionedAssetPage } from "@/lib/server/one-c-reconciliation-service";

export default function OneCDecommissionedAssetsView({
  result,
  search,
}: {
  result: OneCDecommissionedAssetPage;
  search: string;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-amber-100 p-2 text-amber-700">
            <Database className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Списанные по данным 1С</h1>
            <p className="mt-1 text-sm text-amber-900">
              Найдено {result.total.toLocaleString("ru-RU")} ОС со статусом «Снято с учёта».
              Это справочный список: записи ещё не опубликованы в Inventory.
            </p>
          </div>
        </div>
      </section>

      <form className="flex gap-2 rounded-2xl border border-black/5 bg-white p-4" method="get">
        <input type="hidden" name="source" value="one-c" />
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Поиск по списанным ОС 1С</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            name="q"
            defaultValue={search}
            maxLength={100}
            placeholder="Код, инвентарный номер, название, подразделение или ответственное лицо"
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <button className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white" type="submit">
          Найти
        </button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Код / инв. номер</th>
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Подразделение / ответственный</th>
                <th className="px-4 py-3">Остаточная стоимость</th>
                <th className="px-4 py-3">Связь с Inventory</th>
                <th className="px-4 py-3">Получено из 1С</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {result.data.map((asset) => (
                <tr key={asset.externalId} className="align-top text-zinc-700">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{asset.code ?? "—"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{asset.inventoryNumber ?? "Без инвентарного номера"}</div>
                  </td>
                  <td className="max-w-sm px-4 py-3 font-medium text-zinc-900">{asset.name}</td>
                  <td className="px-4 py-3">
                    <div>{asset.location ?? "Подразделение не указано"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{asset.responsibleName ?? "Ответственный не указан"}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{formatMoney(asset.residualCost)}</td>
                  <td className="px-4 py-3">
                    {asset.linkedItemId ? (
                      <div>
                        <Link className="font-medium text-accent hover:underline" href={`/items/${asset.linkedItemId}`}>
                          {asset.linkedItemName ?? "Открыть предмет"}
                        </Link>
                        <div className="mt-1 text-xs text-zinc-500">Статус: {asset.linkedItemStatus ?? "—"}</div>
                      </div>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">Не связано</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">{formatDate(asset.lastSeenAt)}</td>
                </tr>
              ))}
              {!result.data.length && (
                <tr><td className="px-4 py-10 text-center text-zinc-500" colSpan={6}>Записи не найдены.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pages > 1 && (
        <nav aria-label="Страницы списка 1С" className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-3 text-sm">
          <span className="text-zinc-500">Страница {result.page} из {pages}</span>
          <div className="flex gap-2">
            <PaginationLink disabled={result.page <= 1} href={pageHref(result.page - 1, search)}>Назад</PaginationLink>
            <PaginationLink disabled={result.page >= pages} href={pageHref(result.page + 1, search)}>Далее</PaginationLink>
          </div>
        </nav>
      )}
    </div>
  );
}

function PaginationLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  return disabled
    ? <span aria-disabled="true" className="rounded-lg border border-zinc-200 px-3 py-2 text-zinc-300">{children}</span>
    : <Link className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50" href={href}>{children}</Link>;
}

function pageHref(page: number, search: string) {
  const params = new URLSearchParams({ source: "one-c", page: String(page) });
  if (search) params.set("q", search);
  return `/items/decommissioned?${params.toString()}`;
}

function formatMoney(value: string | null) {
  if (value === null) return "Не передана";
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed)} ₸`
    : value;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" }).format(date);
}
