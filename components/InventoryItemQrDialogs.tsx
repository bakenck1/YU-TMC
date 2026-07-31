"use client";

import { Barcode, QrCode, ScanLine, X } from "lucide-react";

type QrDialogKind = "generate" | "scan" | "purpose";
type CodeKind = "barcode" | "qr";

export default function InventoryItemQrDialogs({
  kind,
  codeKind,
  onCodeKindChange,
  onClose,
  onPrint,
}: {
  kind: QrDialogKind | null;
  codeKind: CodeKind;
  onCodeKindChange(value: CodeKind): void;
  onClose(): void;
  onPrint(kind: CodeKind): void;
}) {
  if (!kind) return null;

  const title =
    kind === "generate"
      ? `Генерация ${codeKind === "barcode" ? "штрих-кода" : "QR-кода"}`
      : kind === "scan"
        ? "Как сканировать код?"
        : "Для чего нужен код ТМЦ?";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              {kind === "scan" ? <ScanLine className="h-6 w-6" /> : codeKind === "barcode" ? <Barcode className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
            </div>
            <h2 className="text-lg font-semibold text-zinc-800">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>

        {kind === "generate" ? (
          <div className="mt-6 space-y-4 text-sm text-zinc-600">
            <p>По умолчанию печатается одна наклейка Code 39. При необходимости переключитесь на QR-код.</p>
            <CodeKindSwitch value={codeKind} onChange={onCodeKindChange} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 font-medium text-zinc-600">Отмена</button>
              <button type="button" onClick={() => onPrint(codeKind)} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-white hover:bg-emerald-600">Открыть для печати</button>
            </div>
          </div>
        ) : kind === "scan" ? (
          <div className="mt-6 space-y-4">
            <CodeKindSwitch value={codeKind} onChange={onCodeKindChange} />
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-600">
              <li>Откройте сканер в разделе «Объекты» и выберите формат наклейки.</li>
              <li>По умолчанию сканер ищет штрих-код Code 39; для квадратной метки выберите QR.</li>
              <li>Если камера не распознала код, введите значение под наклейкой вручную.</li>
            </ol>
          </div>
        ) : (
          <div className="mt-6 space-y-3 text-sm leading-6 text-zinc-600">
            <p>Штрих-код Code 39 — основной код предмета. Он содержит официальный инвентарный номер или безопасный системный идентификатор.</p>
            <p>QR-код остаётся дополнительным способом открыть ту же карточку. Оба формата помогают проводить инвентаризацию без ручного поиска.</p>
          </div>
        )}

        {kind !== "generate" ? (
          <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Понятно</button></div>
        ) : null}
      </section>
    </div>
  );
}

function CodeKindSwitch({
  value,
  onChange,
}: {
  value: CodeKind;
  onChange(value: CodeKind): void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1" aria-label="Формат кода">
      <button type="button" onClick={() => onChange("barcode")} aria-pressed={value === "barcode"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold ${value === "barcode" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}>
        <Barcode className="h-4 w-4" /> Code 39
      </button>
      <button type="button" onClick={() => onChange("qr")} aria-pressed={value === "qr"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold ${value === "qr" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}>
        <QrCode className="h-4 w-4" /> QR
      </button>
    </div>
  );
}
