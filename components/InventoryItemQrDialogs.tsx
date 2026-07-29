"use client";

import { QrCode, ScanLine, X } from "lucide-react";

type QrDialogKind = "generate" | "scan" | "purpose";

export default function InventoryItemQrDialogs({
  kind,
  labelCount,
  onLabelCountChange,
  onClose,
  onPrint,
}: {
  kind: QrDialogKind | null;
  labelCount: string;
  onLabelCountChange(value: string): void;
  onClose(): void;
  onPrint(): void;
}) {
  if (!kind) return null;

  const title =
    kind === "generate"
      ? "Генерация QR-кода"
      : kind === "scan"
        ? "Как сканировать QR-код?"
        : "Для чего QR-код ТМЦ?";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              {kind === "scan" ? <ScanLine className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
            </div>
            <h2 className="text-lg font-semibold text-zinc-800">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>

        {kind === "generate" ? (
          <div className="mt-6 space-y-4 text-sm text-zinc-600">
            <p>QR-код предмета уже создан и сохранён в базе. Укажите, сколько наклеек нужно подготовить для печати.</p>
            <label className="block max-w-xs">
              <span className="text-xs font-medium text-zinc-500">Количество наклеек</span>
              <input type="number" min="1" max="100" value={labelCount} onChange={(event) => onLabelCountChange(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 font-medium text-zinc-600">Отмена</button>
              <button type="button" onClick={onPrint} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-white hover:bg-emerald-600">Открыть лист для печати</button>
            </div>
          </div>
        ) : kind === "scan" ? (
          <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-600">
            <li>Откройте сканер QR-кода в разделе «Управление инвентарём» или камерой телефона.</li>
            <li>Наведите камеру на наклейку, чтобы открыть карточку предмета или кабинета.</li>
            <li>Если камера не распознала код, введите инвентарный номер вручную.</li>
          </ol>
        ) : (
          <div className="mt-6 space-y-3 text-sm leading-6 text-zinc-600">
            <p>QR-код связывает физический предмет с его карточкой в базе: местом, ответственным, статусом и историей учёта.</p>
            <p>Он помогает быстро проводить инвентаризацию, перемещать ТМЦ и исключать ошибки при ручном поиске.</p>
          </div>
        )}

        {kind !== "generate" ? (
          <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Понятно</button></div>
        ) : null}
      </section>
    </div>
  );
}
