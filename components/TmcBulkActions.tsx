"use client";

import Link from "next/link";
import { ArrowRightLeft, MapPin, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import TmcUserPicker from "@/components/TmcUserPicker";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type {
  CreateTmcTransferRequestResultDto,
  TmcBulkOperationResultDto,
  TmcOperationItemOutcomeDto,
  TmcOperationUserDto,
  TmcTransferRequestCreationItemOutcomeDto,
} from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import type { TranslationKey } from "@/lib/i18n";
import type { InventoryItem } from "@/lib/types";

type Mode = "transfer" | "location";
type Outcome = TmcTransferRequestCreationItemOutcomeDto | TmcOperationItemOutcomeDto;

export default function TmcBulkActions({
  items,
  actorUserId,
  actorRole,
  buildings,
  rooms,
  variant = "transfer",
  onComplete,
  onClear,
}: {
  items: InventoryItem[];
  actorUserId: string;
  actorRole: UserRole;
  buildings: BuildingDto[];
  rooms: RoomDto[];
  variant?: "transfer" | "issue";
  onComplete: () => void;
  onClear?: () => void;
}) {
  const { t } = useAppSettings();
  const [mode, setMode] = useState<Mode | null>(null);
  const [recipient, setRecipient] = useState<TmcOperationUserDto | null>(null);
  const [buildingId, setBuildingId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [operationItems, setOperationItems] = useState<InventoryItem[]>([]);
  const transferKey = useRef<string | null>(null);
  const canTransfer = actorRole === "admin" || (
    variant === "issue" && items.every((item) => item.responsibleId === actorUserId)
  );
  const displayedItems = mode ? operationItems : items;
  const selectionValid = displayedItems.length > 0 && displayedItems.length <= 50;
  const activeRooms = useMemo(
    () => rooms.filter((room) => room.status === "active" && room.buildingId === buildingId),
    [buildingId, rooms],
  );

  function open(nextMode: Mode) {
    setMode(nextMode);
    setOperationItems(items);
    setRecipient(null);
    setBuildingId("");
    setRoomId("");
    setComment("");
    setOutcomes(null);
    setRequestId(null);
    setError(null);
    transferKey.current = null;
  }

  function close() {
    if (busy) return;
    setMode(null);
    if (outcomes) onClear?.();
  }

  async function submitTransfer() {
    if (!recipient || !selectionValid) return;
    setBusy(true);
    setError(null);
    transferKey.current ??= createIdempotencyKey();
    try {
      const response = await fetch("/api/inventory/transfer-requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": transferKey.current,
        },
        body: JSON.stringify({
          recipientId: recipient.id,
          itemIds: operationItems.map((item) => item.id),
          comment: comment.trim() || null,
        }),
      });
      const payload = await response.json() as {
        result?: CreateTmcTransferRequestResultDto;
        error?: string;
      };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? "request_failed");
      setOutcomes(payload.result.items);
      setRequestId(payload.result.request?.id ?? null);
      if (payload.result.included > 0) {
        onComplete();
      } else {
        transferKey.current = null;
      }
    } catch {
      setError(t("tmc.bulk.error"));
    } finally {
      setBusy(false);
    }
  }

  async function submitLocation() {
    if (!roomId || !selectionValid) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/items/bulk-location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomId,
          items: operationItems.map((item) => ({ itemId: item.id, itemVersion: item.version ?? 0 })),
          comment: comment.trim() || null,
        }),
      });
      const payload = await response.json() as {
        result?: TmcBulkOperationResultDto;
        error?: string;
      };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? "request_failed");
      setOutcomes(payload.result.items);
      if (payload.result.succeeded > 0) {
        onComplete();
      }
    } catch {
      setError(t("tmc.bulk.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-white p-3 shadow-lg sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm font-semibold text-zinc-800">
          {t("items.selected", { count: items.length })}
          {!selectionValid ? <span className="ml-2 font-normal text-rose-600">{t("tmc.bulk.maximum")}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {actorRole === "admin" ? (
            <button type="button" disabled={!selectionValid} onClick={() => open("location")} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 disabled:opacity-50">
              <MapPin className="h-4 w-4" /> {t("tmc.bulk.changeLocation")}
            </button>
          ) : null}
          {canTransfer ? (
            <button type="button" disabled={!selectionValid} onClick={() => open("transfer")} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-50">
              <ArrowRightLeft className="h-4 w-4" /> {t(variant === "issue" ? "tmc.operation.issue" : "tmc.bulk.transfer")}
            </button>
          ) : null}
          {onClear ? <button type="button" onClick={onClear} className="min-h-10 rounded-xl border border-black/10 px-4 text-sm text-zinc-600">{t("tmc.bulk.clear")}</button> : null}
        </div>
      </div>

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section role="dialog" aria-modal="true" aria-label={t(mode === "transfer" ? "tmc.bulk.transfer" : "tmc.bulk.changeLocation")} className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">{t(mode === "transfer" ? "tmc.bulk.transferTitle" : "tmc.bulk.locationTitle")}</h2>
                <p className="mt-1 text-sm text-zinc-500">{t("tmc.bulk.selectedCount", { count: operationItems.length })}</p>
              </div>
              <button type="button" aria-label={t("common.close")} onClick={close} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>

            {mode === "transfer" ? <p className="mt-5 text-sm leading-6 text-zinc-500">{t("tmc.bulk.transferExplanation")}</p> : null}

            <ul className="mt-4 max-h-52 space-y-2 overflow-y-auto rounded-2xl bg-zinc-50 p-3">
              {operationItems.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 rounded-xl bg-white px-3 py-2 text-sm">
                  <span><strong className="block text-zinc-800">{item.name}</strong><span className="text-zinc-500">{item.inventoryNumber} · {item.location}</span></span>
                  <span className="flex shrink-0 items-center gap-2 text-zinc-500">
                    <span>{item.responsible || t("common.notAssigned")}</span>
                    {!outcomes ? <button type="button" aria-label={t("tmc.bulk.removeItem", { name: item.name })} onClick={() => setOperationItems((current) => current.filter((entry) => entry.id !== item.id))} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : null}
                  </span>
                </li>
              ))}
            </ul>

            {!outcomes ? (
              <div className="mt-5 space-y-4">
                {mode === "transfer" ? <TmcUserPicker value={recipient} onChange={setRecipient} /> : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm text-zinc-600">{t("tmc.bulk.building")}
                      <select aria-label={t("tmc.bulk.building")} value={buildingId} onChange={(event) => { setBuildingId(event.target.value); setRoomId(""); }} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5">
                        <option value="">{t("tmc.bulk.chooseBuilding")}</option>
                        {buildings.filter((building) => building.status === "active").map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-zinc-600">{t("tmc.bulk.room")}
                      <select aria-label={t("tmc.bulk.room")} value={roomId} disabled={!buildingId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 disabled:bg-zinc-100">
                        <option value="">{t("tmc.bulk.chooseRoom")}</option>
                        {activeRooms.map((room) => <option key={room.id} value={room.id}>{room.designation}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                <label className="block text-sm text-zinc-600">{t("tmc.operation.comment")}
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5" />
                </label>
              </div>
            ) : <OperationResults items={operationItems} outcomes={outcomes} requestId={requestId} />}

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-zinc-600">{outcomes ? t("common.close") : t("common.cancel")}</button>
              {!outcomes ? <button type="button" disabled={busy || (mode === "transfer" ? !recipient : !roomId) || !selectionValid} onClick={mode === "transfer" ? submitTransfer : submitLocation} className="min-h-11 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? t("tmc.operation.submitting") : t(mode === "transfer" ? "tmc.bulk.submitTransfer" : "tmc.bulk.submitLocation")}</button> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function OperationResults({ items, outcomes, requestId }: { items: InventoryItem[]; outcomes: Outcome[]; requestId: string | null }) {
  const { t } = useAppSettings();
  const itemById = new Map(items.map((item) => [item.id, item]));
  return (
    <div className="mt-5 rounded-2xl border border-black/5 p-4">
      <h3 className="font-semibold text-zinc-900">{t("tmc.bulk.results")}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {outcomes.map((outcome) => (
          <li key={outcome.itemId} className="flex justify-between gap-4">
            <span>{itemById.get(outcome.itemId)?.name ?? outcome.itemId}</span>
            <span className={outcome.outcome === "problem" ? "text-rose-700" : "text-emerald-700"}>
              {outcome.outcome === "problem" ? t(`tmc.problem.${outcome.problem}` as TranslationKey) : t("tmc.bulk.success")}
            </span>
          </li>
        ))}
      </ul>
      {requestId ? <Link href={`/tmc/transfer-requests/${requestId}`} className="mt-4 inline-flex font-semibold text-emerald-700 hover:underline">{t("tmc.bulk.openRequest")}</Link> : null}
    </div>
  );
}

function createIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `tmc-desktop-${uuid}` : `tmc-desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
