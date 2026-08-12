"use client";

import { ArrowRightLeft, ChevronDown, MapPin, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import TmcUserPicker from "@/components/TmcUserPicker";
import TmcOperationResults from "@/components/TmcOperationResults";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type {
  CreateTmcTransferRequestResultDto,
  TmcBulkOperationResultDto,
  TmcOperationItemOutcomeDto,
  TmcOperationUserDto,
  TmcTransferRequestCreationItemOutcomeDto,
} from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
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
  const [actionsOpen, setActionsOpen] = useState(false);
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
  const actionsRef = useRef<HTMLDivElement>(null);
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
    setActionsOpen(false);
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
      {actorRole === "admin" || canTransfer ? (
        <div
          ref={actionsRef}
          className="relative z-40 inline-block"
          onBlur={(event) => {
            if (!actionsRef.current?.contains(event.relatedTarget)) {
              setActionsOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setActionsOpen(false);
          }}
        >
          <button
            type="button"
            aria-label={t("tmc.bulk.actions")}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            title={!selectionValid ? t("tmc.bulk.maximum") : undefined}
            onClick={() => setActionsOpen((open) => !open)}
            className="inline-flex min-h-12 items-center gap-2.5 rounded-xl border border-emerald-400 bg-emerald-500 px-5 text-base font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.35)] transition hover:border-emerald-500 hover:bg-emerald-600 hover:shadow-[0_14px_34px_rgba(16,185,129,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 active:translate-y-px"
          >
            <span>{t("tmc.bulk.actions")}</span>
            <span className="rounded-md bg-white/20 px-2 py-1 text-sm font-bold tabular-nums text-white ring-1 ring-inset ring-white/25">{items.length}</span>
            <ChevronDown className={`h-4 w-4 text-white/80 transition-transform ${actionsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>

          {actionsOpen ? (
            <div role="menu" className="absolute left-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-left overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
              <p className="px-3 py-2 text-xs text-zinc-400">{t("items.selected", { count: items.length })}</p>
              {actorRole === "admin" ? (
                <button type="button" role="menuitem" disabled={!selectionValid} onClick={() => open("location")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <MapPin className="h-4 w-4 text-zinc-400" aria-hidden="true" /> {t("tmc.bulk.changeLocation")}
                </button>
              ) : null}
              {canTransfer ? (
                <button type="button" role="menuitem" disabled={!selectionValid} onClick={() => open("transfer")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <ArrowRightLeft className="h-4 w-4 text-zinc-400" aria-hidden="true" /> {t(variant === "issue" ? "tmc.operation.issue" : "tmc.bulk.transfer")}
                </button>
              ) : null}
              {onClear ? (
                <>
                  <div className="my-1 border-t border-zinc-100" />
                  <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); onClear(); }} className="flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700">
                    {t("tmc.bulk.clear")}
                  </button>
                </>
              ) : null}
              {!selectionValid ? <p className="px-3 py-2 text-xs text-rose-600">{t("tmc.bulk.maximum")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section role="dialog" aria-modal="true" aria-label={t(mode === "transfer" ? "tmc.bulk.transfer" : "tmc.bulk.changeLocation")} className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">{t(mode === "transfer" ? (actorRole === "admin" ? "tmc.bulk.assignmentTitle" : "tmc.bulk.transferTitle") : "tmc.bulk.locationTitle")}</h2>
                <p className="mt-1 text-sm text-zinc-500">{t("tmc.bulk.selectedCount", { count: operationItems.length })}</p>
              </div>
              <button type="button" aria-label={t("common.close")} onClick={close} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>

            {mode === "transfer" ? <p className="mt-5 text-sm leading-6 text-zinc-500">{t(actorRole === "admin" ? "tmc.bulk.assignmentExplanation" : "tmc.bulk.transferExplanation")}</p> : null}

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
            ) : <TmcOperationResults items={operationItems} outcomes={outcomes} requestId={requestId} />}

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-zinc-600">{outcomes ? t("common.close") : t("common.cancel")}</button>
              {!outcomes ? <button type="button" disabled={busy || (mode === "transfer" ? !recipient : !roomId) || !selectionValid} onClick={mode === "transfer" ? submitTransfer : submitLocation} className="min-h-11 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? t("tmc.operation.submitting") : t(mode === "transfer" ? (actorRole === "admin" ? "tmc.bulk.submitAssignment" : "tmc.bulk.submitTransfer") : "tmc.bulk.submitLocation")}</button> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function createIdempotencyKey() {
  return `tmc-desktop-${crypto.randomUUID()}`;
}
