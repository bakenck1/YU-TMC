"use client";

import { Barcode, RefreshCw, ScanLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import InventoryTransferList from "@/components/InventoryTransferList";
import type { TransferDto } from "@/lib/contracts/inventory-responsibility";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import { employeeScanAction } from "@/lib/employee-asset-workflow";

type ScanResult = NonNullable<QrResolutionDto["target"]>;

export default function InventoryTransfersManager() {
  const router = useRouter();
  const [transfers, setTransfers] = useState<TransferDto[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [rejectComments, setRejectComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory/transfers", { cache: "no-store" });
      const body = (await response.json()) as { transfers?: TransferDto[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "transfer_unavailable");
      setTransfers(body.transfers ?? []);
    } catch {
      setMessage("Не удалось загрузить запросы на передачу.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadTransfers(), 0);
    const interval = window.setInterval(() => void loadTransfers(), 15_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [loadTransfers]);

  async function resolveCode(value: string) {
    setScannerOpen(false);
    setBusy(true);
    setMessage("");
    setScanResult(null);
    try {
      const response = await fetch(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(value)}&kind=barcode`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as { resolution?: QrResolutionDto; error?: string };
      if (!response.ok || body.resolution?.status !== "resolved" || body.resolution.target?.kind !== "item") {
        throw new Error(body.error ?? "item_not_found");
      }
      setScanResult(body.resolution.target);
    } catch {
      setMessage("Код не относится к доступному активному ТМЦ.");
    } finally {
      setBusy(false);
    }
  }

  async function requestTransfer() {
    if (!scanResult) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/inventory/transfers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: scanResult.id }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        const known: Record<string, string> = {
          already_responsible: "Этот ТМЦ уже закреплён за вами.",
          transfer_already_pending: "По этому ТМЦ уже ожидается решение владельца.",
          item_is_free: "У ТМЦ нет владельца: используйте принятие свободного ТМЦ.",
        };
        throw new Error(known[body.error ?? ""] ?? "Не удалось отправить запрос.");
      }
      setScanResult(null);
      setMessage("Запрос отправлен текущему владельцу.");
      await loadTransfers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отправить запрос.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptFreeItem() {
    if (!scanResult) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/inventory/items/${scanResult.id}/responsibility/accept`,
        { method: "POST", credentials: "same-origin" },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "item_accept_failed");
      setScanResult(null);
      setMessage("ТМЦ закреплён за вами.");
      router.refresh();
      await loadTransfers();
    } catch {
      setMessage("Не удалось закрепить ТМЦ. Обновите карточку и повторите попытку.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(transfer: TransferDto, decision: "confirm" | "reject") {
    const comment = rejectComments[transfer.id]?.trim();
    if (decision === "reject" && !comment) {
      setMessage("Укажите причину отклонения.");
      return;
    }
    await mutate(`/api/inventory/transfers/${transfer.id}/decision`, {
      version: transfer.version,
      decision,
      comment: decision === "reject" ? comment : null,
    });
  }

  async function cancel(transfer: TransferDto) {
    await mutate(`/api/inventory/transfers/${transfer.id}/cancel`, {
      version: transfer.version,
    });
  }

  async function mutate(url: string, body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      setMessage("Решение сохранено.");
      await loadTransfers();
    } catch {
      setMessage("Запрос уже изменён или действие недоступно. Список обновлён.");
      await loadTransfers();
    } finally {
      setBusy(false);
    }
  }

  const incoming = transfers.filter((transfer) => transfer.direction === "incoming");
  const outgoing = transfers.filter((transfer) => transfer.direction === "outgoing");
  const pendingIncoming = incoming.filter(
    (transfer) => transfer.status === "pending_current_owner",
  );
  const scanAction = scanResult
    ? employeeScanAction({
        status: scanResult.status as "active" | "maintenance" | "decommissioned",
        isAssigned: scanResult.isAssigned,
        isCurrentUserResponsible: scanResult.isCurrentUserResponsible,
      })
    : ({ kind: "unavailable" } as const);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Сканировать ТМЦ</h1>
          <p className="mt-1 text-sm text-zinc-500">Сканируйте QR чужого ТМЦ или обработайте входящий запрос.</p>
        </div>
        <button type="button" onClick={() => setScannerOpen(true)} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          <ScanLine className="h-4 w-4" /> Сканировать QR
        </button>
      </header>

      {message ? <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p> : null}

      {pendingIncoming.length > 0 ? (
        <section
          aria-label="Уведомления о передаче"
          className="rounded-2xl border border-blue-200 bg-blue-50 p-5"
        >
          <h2 className="font-semibold text-blue-950">Уведомления о передаче</h2>
          <p className="mt-1 text-sm text-blue-800">
            Сотрудник запросил один из закреплённых за вами предметов. Подтвердите или отклоните запрос ниже.
          </p>
        </section>
      ) : null}

      {scanResult ? (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" aria-label="Результат сканирования">
          <div className="flex gap-3"><Barcode className="mt-0.5 h-5 w-5 text-emerald-600" /><div><h2 className="font-semibold text-zinc-900">{scanResult.title}</h2><p className="mt-1 text-sm text-zinc-500">{[scanResult.inventoryNumber, scanResult.buildingName, scanResult.roomDesignation].filter(Boolean).join(" · ")}</p></div></div>
          {scanAction.kind === "claim_free" ? (
            <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Этот свободный предмет можно сразу закрепить за собой.</p>
          ) : null}
          {scanAction.kind === "request_transfer" ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Этот предмет закреплён за другим сотрудником. Вы не можете подключить его напрямую — запросите передачу.</p>
          ) : null}
          {scanAction.kind === "already_owned" ? (
            <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-900">Этот предмет уже закреплён за вами.</p>
          ) : null}
          {scanAction.kind === "unavailable" ? (
            <p className="mt-3 rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700">Этот предмет сейчас недоступен для передачи.</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {scanAction.kind === "claim_free" ? <button type="button" onClick={() => void acceptFreeItem()} disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Закрепить за собой</button> : null}
            {scanAction.kind === "request_transfer" ? <button type="button" onClick={() => void requestTransfer()} disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Запросить передачу</button> : null}
            <button type="button" onClick={() => setScanResult(null)} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700">Отмена</button>
          </div>
        </section>
      ) : null}

      <InventoryTransferList
        kind="incoming"
        transfers={incoming}
        loading={loading}
        busy={busy}
        rejectComments={rejectComments}
        onRejectCommentChange={(transferId, value) => setRejectComments((comments) => ({ ...comments, [transferId]: value }))}
        onConfirm={(transfer) => void decide(transfer, "confirm")}
        onReject={(transfer) => void decide(transfer, "reject")}
      />
      <InventoryTransferList
        kind="outgoing"
        transfers={outgoing}
        loading={loading}
        busy={busy}
        onCancel={(transfer) => void cancel(transfer)}
      />

      <button type="button" onClick={() => void loadTransfers()} disabled={loading} className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Обновить</button>
      {scannerOpen ? <InventoryItemCodeScanner onClose={() => setScannerOpen(false)} onCodeSelected={(value) => void resolveCode(value)} /> : null}
    </div>
  );
}
