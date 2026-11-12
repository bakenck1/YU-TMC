"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PossibleCard, PossibleCode } from "@/lib/server/one-c-possible-matches";

export default function OneCPossibleMatches() {
  const [cards, setCards] = useState<PossibleCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ card: PossibleCard; candidate: PossibleCode } | null>(null);
  const router = useRouter();

  async function load() {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const response = await fetch("/api/integrations/1c/possible", { cache: "no-store" });
      if (!response.ok || response.redirected) throw new Error();
      setCards((await response.json()).data);
    } catch { setError("Не удалось загрузить варианты. Повторите попытку."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/integrations/1c/possible", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: selected.card.id, itemVersion: selected.card.itemVersion,
          reviewHash: selected.card.reviewHash, code: selected.candidate.code }),
      });
      if (response.status === 409) {
        setSelected(null);
        setCards(null);
        setError("Карточка или данные 1С изменились. Загрузите варианты заново.");
        return;
      }
      if (!response.ok || response.redirected) throw new Error();
      setCards(current => current?.filter(card => card.id !== selected.card.id) ?? []);
      setSelected(null);
      router.refresh();
    } catch { setError("Не удалось сохранить связь. Проверьте права доступа и повторите попытку."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" disabled={busy} onClick={() => void load()} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">{busy ? "Загрузка…" : "Проверить возможные совпадения"}</button>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {cards?.length === 0 ? <p role="status">Нет совпадений, требующих подтверждения.</p> : null}
    {cards?.map(card => <article key={card.id} className="space-y-3 rounded-xl bg-slate-50 p-4">
      <h3 className="font-semibold">{card.name} · {card.inventoryNumber}</h3>
      {card.itemSection !== "general" ? <a href={`/it-items/${card.id}`} className="text-sm text-blue-700 underline">Открыть IT-карточку для проверки</a> : null}
      {card.candidates.map(candidate => <div key={candidate.code} className="space-y-3 border-t border-slate-200 pt-3">
        <p className="text-sm font-medium">Код номенклатуры 1С {candidate.code} · строк источника {candidate.balances.length}</p>
        {candidate.balances.map((balance, index) => <div key={`${balance.source}-${balance.sourceId}-${index}`} className="min-w-0 break-words text-sm">
          <p>{balance.name} · {candidate.code} · {balance.price === null ? "Цена не передана" : `${balance.price} ₸`} · {balance.responsible ?? "Ответственный не указан"}</p>
          <p className="mt-1 text-xs text-slate-500">{balance.source === "OS" ? "ОС" : "МП"} · номер в 1С {balance.number ?? "—"}</p>
        </div>)}
        {card.itemSection === "general" ? <button type="button" disabled={busy} onClick={() => setSelected({ card, candidate })} className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50">Выбрать код {candidate.code}</button> : null}
      </div>)}
    </article>)}
    {selected ? <div role="region" aria-label="Подтверждение связи" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p>Связать «{selected.card.name}» ({selected.card.inventoryNumber}) с кодом номенклатуры 1С {selected.candidate.code}?</p>
      <p className="text-sm">Этот код объединяет {selected.candidate.balances.length} строк источника. Цену и ответственного можно проверить и применить в разделе обновления карточек.</p>
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-blue-700 px-4 py-2 text-white">Подтвердить код</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Отмена</button></div>
    </div> : null}
  </section>;
}
