"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { MaterialSnapshotMetadata } from "@/lib/server/material-snapshot-service";

export default function MaterialSnapshotUploadPanel({ initialSnapshot, onUploaded }: {
  initialSnapshot?: MaterialSnapshotMetadata | null;
  onUploaded(snapshot: MaterialSnapshotMetadata): void;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/integrations/1c/material-snapshot", { method: "POST", body: form, credentials: "same-origin" });
      const body = await response.json() as { snapshot?: MaterialSnapshotMetadata; error?: string };
      if (!response.ok || !body.snapshot) throw new Error(body.error ?? "upload_failed");
      setSnapshot(body.snapshot);
      setFile(null);
      onUploaded(body.snapshot);
      formElement.reset();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "payload_too_large" ? "Файл превышает 8 МБ." : code.startsWith("material_snapshot_") || code === "invalid_material_snapshot_file" ? "Файл не соответствует ведомости XLS: проверьте формат и колонки." : "Не удалось загрузить XLS. Проверьте доступ и повторите попытку.");
    } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-black/5 bg-white p-4">
    <h2 className="font-semibold">Материальная ведомость Excel</h2>
    <p className="mt-1 text-sm text-zinc-600">Выберите файл «материалы 2026.xls» со своего компьютера. После загрузки запустите dry-run выбранной партии 1С. Excel используется только для поиска совпадений.</p>
    <form onSubmit={(event) => void upload(event)} className="mt-3 flex flex-wrap items-center gap-3">
      <input aria-label="Файл материальной ведомости XLS" type="file" accept=".xls,application/vnd.ms-excel" required disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="text-sm" />
      <button disabled={!file || busy} className="rounded-xl bg-[#002060] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Загрузка…" : "Загрузить Excel"}</button>
    </form>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {snapshot ? <div className="mt-3 text-sm text-zinc-700">
      <p>Активный снимок: <strong>{snapshot.filename}</strong> · загружен {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.receivedAt))} · выбран {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.selectedAt))}</p>
      <p>Строк с номерами для поиска: {snapshot.acceptedCount}; строк без распознаваемого номера: {snapshot.skippedCount}; размер: {snapshot.byteSize} байт.</p>
      <p className="text-xs text-zinc-500">Вся ведомость прочитана. Номера вида 1350/14464 без № тоже участвуют в поиске и требуют проверки. Название и код Excel сами по себе не дают совпадения.</p>
      {snapshot.importedAcceptedCount !== snapshot.acceptedCount || snapshot.importedSkippedCount !== snapshot.skippedCount ? <p className="text-xs text-zinc-500">При первоначальной загрузке: {snapshot.importedAcceptedCount} строк с номерами, {snapshot.importedSkippedCount} без номера. Текущий поиск использует обновлённый разбор исходного файла.</p> : null}
      <p>SHA-256: <code className="break-all">{snapshot.sha256}</code></p>
    </div> : <p className="mt-3 text-sm text-amber-800">Снимок Excel ещё не загружен. Для общего dry-run загрузите XLS.</p>}
  </section>;
}
