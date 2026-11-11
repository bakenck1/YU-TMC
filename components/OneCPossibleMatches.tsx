"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = { name: string; code: string | null; number: string | null; price: string | number | null; responsible: string | null };
type Card = { id: string; name: string; inventoryNumber: string; candidates: Candidate[] };

export default function OneCPossibleMatches() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ card: Card; candidate: Candidate } | null>(null);
  const router = useRouter();
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/1c/possible", { cache: "no-store" });
      if (!response.ok || response.redirected) throw new Error();
      setCards((await response.json()).data);
    } catch { setError("Не удалось загрузить варианты. Повторите попытку."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!selected?.candidate.code) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/items/bulk-one-c-code", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [selected.card.id], oneCCode: selected.candidate.code }),
      });
      if (!response.ok || response.redirected) throw new Error();
      setCards(current => current?.filter(card => card.id !== selected.card.id) ?? []);
      setSelected(null); router.refresh();
    } catch { setError("Не удалось сохранить связь. Проверьте права доступа и повторите попытку."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" disabled={busy} onClick={() => void load()} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">{busy ? "Загрузка…" : "Проверить возможные совпадения"}</button>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {cards?.length === 0 ? <p role="status">Нет совпадений, требующих подтверждения.</p> : null}
    {cards?.map(card => <article key={card.id} className="space-y-3 rounded-xl bg-slate-50 p-4">
      <h3 className="font-semibold">{card.name} · {card.inventoryNumber}</h3>
      {card.candidates.map((candidate, index) => <div key={index} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <div className="min-w-0 break-words text-sm"><p>{candidate.name} · {candidate.code ?? "Без кода"} · {candidate.price === null ? "Цена не передана" : `${candidate.price} ₸`} · {candidate.responsible ?? "Ответственный не указан"}</p><p className="mt-1 text-xs text-slate-500">Номер в 1С: {candidate.number ?? "—"}</p></div>
        <button type="button" disabled={busy || !candidate.code} onClick={() => setSelected({ card, candidate })} className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Выбрать</button>
      </div>)}
    </article>)}
    {selected ? <div role="region" aria-label="Подтверждение связи" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p>Связать «{selected.card.name}» ({selected.card.inventoryNumber}) с кодом 1С {selected.candidate.code}?</p>
      <p className="text-sm">Код сохранится в карточке. Цена и ответственный применяются отдельно в разделе обновления карточек.</p>
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-blue-700 px-4 py-2 text-white">Подтвердить связь</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Отмена</button></div>
    </div> : null}
  </section>;
}
