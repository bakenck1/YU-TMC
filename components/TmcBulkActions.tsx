"use client";

import { ArrowRightLeft, ChevronDown, MapPin, Tags, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import LocalBarcodeTransferResult from "@/components/LocalBarcodeTransferResult";
import TmcUserPicker from "@/components/TmcUserPicker";
import TmcOperationResults from "@/components/TmcOperationResults";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type {
  LocalBarcodeDistributionDto,
  LocalBarcodeGroupDto,
} from "@/lib/contracts/local-barcodes";
import type {
  CreateTmcTransferRequestResultDto,
  TmcBulkOperationResultDto,
  TmcOperationItemOutcomeDto,
  TmcOperationUserDto,
  TmcTransferRequestCreationItemOutcomeDto,
} from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import type { InventoryItem } from "@/lib/types";

type Mode = "transfer" | "location" | "category" | "delete";
type Outcome = TmcTransferRequestCreationItemOutcomeDto | TmcOperationItemOutcomeDto;
type LocalSource = {
  distribution: LocalBarcodeDistributionDto;
  quantity: string;
};

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
  const [category, setCategory] = useState<"electronics" | "furniture">("electronics");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [localSources, setLocalSources] = useState<Record<string, LocalSource>>({});
  const [localSourcesLoading, setLocalSourcesLoading] = useState(false);
  const [localGroups, setLocalGroups] = useState<LocalBarcodeGroupDto[] | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [operationItems, setOperationItems] = useState<InventoryItem[]>([]);
  const transferKey = useRef<string | null>(null);
  const localTransferKeys = useRef<Record<string, string>>({});
  const localSourceSequence = useRef(0);
  const actionsRef = useRef<HTMLDivElement>(null);
  const canTransfer = actorRole === "admin" || (
    variant === "issue" && items.every((item) => item.responsibleId === actorUserId)
  );
  const displayedItems = mode ? operationItems : items;
  const usesLocalQuantityTransfer =
    mode === "transfer" &&
    operationItems.some((item) => (item.quantity ?? 1) >= 2);
  const selectionValid = displayedItems.length > 0 && displayedItems.length <= (mode === "transfer" || mode === "location" ? 50 : 2_000);
  const standardSelectionValid = items.length > 0 && items.length <= 50;
  const categorySelectionValid = items.length > 0 && items.length <= 2_000;
  const activeRooms = useMemo(
    () => rooms.filter((room) => room.status === "active" && room.buildingId === buildingId),
    [buildingId, rooms],
  );
  const localQuantityValid =
    !usesLocalQuantityTransfer ||
    (!localSourcesLoading &&
      operationItems.every((item) => {
        const source = localSources[item.id];
        if (!source) return false;
        const quantity = Number(source.quantity);
        return (
          Number.isSafeInteger(quantity) &&
          quantity >= 1 &&
          quantity <= source.distribution.originalRemainder
        );
      }));

  function open(nextMode: Mode) {
    setActionsOpen(false);
    setMode(nextMode);
    setOperationItems(items);
    setRecipient(null);
    setBuildingId("");
    setRoomId("");
    setCategory("electronics");
    setComment("");
    setOutcomes(null);
    setLocalSources({});
    setLocalSourcesLoading(false);
    setLocalGroups(null);
    setRequestId(null);
    setError(null);
    transferKey.current = null;
    localTransferKeys.current = {};
    localSourceSequence.current += 1;
    if (
      nextMode === "transfer" &&
      items.some((item) => (item.quantity ?? 1) >= 2)
    ) {
      void loadLocalSources(items);
    }
  }

  function close() {
    if (busy) return;
    setMode(null);
    localSourceSequence.current += 1;
    if (outcomes || localGroups) onClear?.();
  }

  async function loadLocalSources(nextItems: InventoryItem[]) {
    const sequence = ++localSourceSequence.current;
    setLocalSourcesLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        nextItems.map(async (item) => {
          const response = await fetch(
            `/api/inventory/local-barcodes?itemId=${encodeURIComponent(item.id)}`,
            { cache: "no-store", credentials: "same-origin" },
          );
          const body = (await response.json().catch(() => ({}))) as {
            distribution?: LocalBarcodeDistributionDto;
            error?: string;
          };
          if (!response.ok || !body.distribution) {
            throw new Error(body.error ?? "local_distribution_failed");
          }
          return [
            item.id,
            { distribution: body.distribution, quantity: "1" },
          ] as const;
        }),
      );
      if (sequence === localSourceSequence.current) {
        setLocalSources(Object.fromEntries(entries));
      }
    } catch {
      if (sequence === localSourceSequence.current) {
        setError(t("tmc.localBarcode.error"));
      }
    } finally {
      if (sequence === localSourceSequence.current) {
        setLocalSourcesLoading(false);
      }
    }
  }

  async function submitTransfer() {
    if (usesLocalQuantityTransfer && actorRole === "admin") {
      await submitLocalQuantityTransfer();
      return;
    }
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
          ...(usesLocalQuantityTransfer
            ? {
                quantityTransfers: operationItems.map((item) => {
                  const source = localSources[item.id]!;
                  return {
                    itemId: item.id,
                    sourceLocalGroupId: null,
                    sourceVersion: source.distribution.originalVersion,
                    quantity: Number(source.quantity),
                  };
                }),
              }
            : {}),
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

  async function submitLocalQuantityTransfer() {
    if (!recipient || !selectionValid || !localQuantityValid) return;
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        operationItems.map(async (item) => {
          const source = localSources[item.id];
          if (!source) throw new Error("local_distribution_missing");
          const key =
            localTransferKeys.current[item.id] ??
            `tmc-local:${crypto.randomUUID()}`;
          localTransferKeys.current[item.id] = key;
          const response = await fetch("/api/inventory/local-barcodes", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify({
              itemId: item.id,
              sourceGroupId: null,
              recipientUserId: recipient.id,
              quantity: Number(source.quantity),
              sourceVersion: source.distribution.originalVersion,
              comment: comment.trim() || null,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            result?: { group: LocalBarcodeGroupDto; createdNewCode: boolean };
            error?: string;
          };
          if (!response.ok || !body.result) {
            throw new Error(body.error ?? "local_barcode_transfer_failed");
          }
          return body.result.group;
        }),
      );
      setLocalGroups(results);
      localTransferKeys.current = {};
      if (results.length > 0) onComplete();
    } catch {
      setError(t("tmc.localBarcode.error"));
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

  async function submitCategory() {
    if (!selectionValid) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/items/bulk-category", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: operationItems.map((item) => item.id), category }),
      });
      if (!response.ok) throw new Error("request_failed");
      setMode(null);
      onClear?.();
      onComplete();
    } catch {
      setError(t("tmc.bulk.error"));
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    if (!selectionValid) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/items/bulk-delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: operationItems.map((item) => item.id) }),
      });
      if (!response.ok) throw new Error("request_failed");
      setMode(null);
      onClear?.();
      onComplete();
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
            title={!categorySelectionValid ? t("tmc.bulk.maximum") : undefined}
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
                <button type="button" role="menuitem" disabled={!standardSelectionValid} onClick={() => open("location")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <MapPin className="h-4 w-4 text-zinc-400" aria-hidden="true" /> {t("tmc.bulk.changeLocation")}
                </button>
              ) : null}
              {actorRole === "admin" ? (
                <button type="button" role="menuitem" disabled={!categorySelectionValid} onClick={() => open("category")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Tags className="h-4 w-4 text-zinc-400" aria-hidden="true" /> {t("items.type")}
                </button>
              ) : null}
              {canTransfer ? (
                <button type="button" role="menuitem" disabled={!standardSelectionValid} onClick={() => open("transfer")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <ArrowRightLeft className="h-4 w-4 text-zinc-400" aria-hidden="true" /> {t(variant === "issue" ? "tmc.operation.issue" : "tmc.bulk.transfer")}
                </button>
              ) : null}
              {actorRole === "admin" ? (
                <button type="button" role="menuitem" disabled={!categorySelectionValid} onClick={() => open("delete")} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t("items.delete")}
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
              {!categorySelectionValid ? <p className="px-3 py-2 text-xs text-rose-600">{t("tmc.bulk.maximum")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section role="dialog" aria-modal="true" aria-label={t(mode === "delete" ? "items.deleteTitle" : mode === "category" ? "items.type" : mode === "transfer" ? "tmc.bulk.transfer" : "tmc.bulk.changeLocation")} className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">{t(mode === "delete" ? "items.deleteTitle" : mode === "category" ? "items.type" : mode === "transfer" ? (actorRole === "admin" ? "tmc.bulk.assignmentTitle" : "tmc.bulk.transferTitle") : "tmc.bulk.locationTitle")}</h2>
                <p className="mt-1 text-sm text-zinc-500">{t("tmc.bulk.selectedCount", { count: operationItems.length })}</p>
              </div>
              <button type="button" aria-label={t("common.close")} onClick={close} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>

            {mode === "transfer" ? <p className="mt-5 text-sm leading-6 text-zinc-500">{t(usesLocalQuantityTransfer ? (actorRole === "admin" ? "tmc.localBarcode.transferExplanation" : "tmc.localBarcode.requestExplanation") : actorRole === "admin" ? "tmc.bulk.assignmentExplanation" : "tmc.bulk.transferExplanation")}</p> : null}
            {mode === "delete" ? <p className="mt-5 text-sm leading-6 text-red-700">{t("items.deleteText")} {t("items.selected", { count: operationItems.length })}</p> : null}

            <ul className="mt-4 max-h-52 space-y-2 overflow-y-auto rounded-2xl bg-zinc-50 p-3">
              {operationItems.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 rounded-xl bg-white px-3 py-2 text-sm">
                  <span><strong className="block text-zinc-800">{item.name}</strong><span className="text-zinc-500">{item.inventoryNumber} · {item.location}</span></span>
                  <span className="flex shrink-0 items-center gap-2 text-zinc-500">
                    <span>{item.responsible || t("common.notAssigned")}</span>
                    {!outcomes && !localGroups ? <button type="button" aria-label={t("tmc.bulk.removeItem", { name: item.name })} onClick={() => setOperationItems((current) => current.filter((entry) => entry.id !== item.id))} className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : null}
                  </span>
                </li>
              ))}
            </ul>

            {!outcomes && !localGroups && mode !== "delete" ? (
              <div className="mt-5 space-y-4">
                {mode === "transfer" ? <TmcUserPicker value={recipient} onChange={(value) => { setRecipient(value); localTransferKeys.current = {}; }} /> : mode === "category" ? (
                  <label className="block text-sm text-zinc-600">{t("items.type")}
                    <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5"><option value="electronics">{t("common.electronics")}</option><option value="furniture">{t("data.furniture")}</option></select>
                  </label>
                ) : (
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
                {mode === "transfer" && usesLocalQuantityTransfer ? (
                  localSourcesLoading ? (
                    <p role="status" className="text-sm text-zinc-500">
                      {t("tmc.localBarcode.loading")}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {operationItems.map((item) => {
                        const source = localSources[item.id];
                        if (!source) return null;
                        const available = source.distribution.originalRemainder;
                        return (
                          <label key={item.id} className="block rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-sm font-semibold text-zinc-800">
                            {t("tmc.localBarcode.quantityQuestion")}
                            {operationItems.length > 1 ? (
                              <span className="ml-1 font-normal text-zinc-600">— {item.name} ({item.inventoryNumber})</span>
                            ) : null}
                            {available >= 2 ? (
                              <input
                                type="number"
                                min={1}
                                max={available}
                                step={1}
                                value={source.quantity}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setLocalSources((current) => ({
                                    ...current,
                                    [item.id]: { ...current[item.id]!, quantity: value },
                                  }));
                                  localTransferKeys.current = {};
                                }}
                                className="mt-2 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 outline-none focus:border-emerald-500"
                              />
                            ) : (
                              <p className="mt-2 font-normal text-zinc-700">1 {t("common.piecesShort")}</p>
                            )}
                            <span className="mt-2 block font-normal text-zinc-500">
                              {t("tmc.localBarcode.available", { count: available })}. {t("tmc.localBarcode.willCreate")}
                            </span>
                            {available < 1 || !Number.isSafeInteger(Number(source.quantity)) || Number(source.quantity) < 1 || Number(source.quantity) > available ? (
                              <span className="mt-1 block font-normal text-red-700">
                                {t("tmc.localBarcode.invalidQuantity", { count: available })}
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  )
                ) : null}
                <label className="block text-sm text-zinc-600">{t(mode === "transfer" && usesLocalQuantityTransfer ? "tmc.localBarcode.comment" : "tmc.operation.comment")}
                  <textarea value={comment} onChange={(event) => { setComment(event.target.value); localTransferKeys.current = {}; }} maxLength={1000} rows={3} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5" />
                </label>
              </div>
            ) : outcomes ? <TmcOperationResults items={operationItems} outcomes={outcomes} requestId={requestId} /> : localGroups ? <LocalBarcodeTransferResult groups={localGroups} /> : null}

            {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-zinc-600">{outcomes || localGroups ? t("common.close") : t("common.cancel")}</button>
              {!outcomes && !localGroups ? <button type="button" disabled={busy || (mode === "transfer" ? !recipient || !localQuantityValid : mode === "location" ? !roomId : false) || !selectionValid} onClick={mode === "transfer" ? submitTransfer : mode === "location" ? submitLocation : mode === "category" ? submitCategory : submitDelete} className={`min-h-11 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50 ${mode === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-500"}`}>{busy ? t("tmc.operation.submitting") : t(mode === "delete" ? "items.delete" : mode === "category" ? "common.save" : mode === "transfer" ? usesLocalQuantityTransfer && actorRole === "admin" ? "tmc.localBarcode.submit" : actorRole === "admin" ? "tmc.bulk.submitAssignment" : "tmc.bulk.submitTransfer" : "tmc.bulk.submitLocation")}</button> : null}
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
