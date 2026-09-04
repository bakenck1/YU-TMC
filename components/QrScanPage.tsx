"use client";

import { Barcode, MapPinned, RotateCcw, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import InventoryRoomQrScanner from "@/components/InventoryRoomQrScanner";
import ScannedItemDetailsCard from "@/components/ScannedItemDetailsCard";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import { parseCreateTmcTransferRequestResult } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";

type ScannedItem = NonNullable<QrResolutionDto["target"]> & { kind: "item" };

export default function QrScanPage({
  actorRole,
}: {
  actorRole: UserRole;
}) {
  const { t } = useAppSettings();
  const router = useRouter();
  const [mode, setMode] = useState<"item" | "room" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [item, setItem] = useState<ScannedItem | null>(null);
  const [action, setAction] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "accepted" }
    | { status: "requested"; requestId: string }
    | { status: "error" }
  >({ status: "idle" });
  const actionInFlight = useRef(false);
  const transferKey = useRef<string | null>(null);

  async function resolveItemCode(value: string) {
    setMode(null);
    setBusy(true);
    setMessage("");
    setItem(null);
    setAction({ status: "idle" });
    transferKey.current = null;
    try {
      const response = await fetch(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(value)}&kind=barcode&target=item`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        resolution?: QrResolutionDto;
      };
      const resolution = body.resolution;
      if (
        !response.ok ||
        resolution?.status !== "resolved" ||
        resolution.qrStatus !== "active" ||
        resolution.target?.kind !== "item"
      ) {
        throw new Error("item_not_available");
      }
      setItem(resolution.target as ScannedItem);
    } catch {
      setMessage(t("tmc.qr.itemUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function acceptFreeItem() {
    if (!item || actionInFlight.current) return;
    actionInFlight.current = true;
    setAction({ status: "submitting" });
    try {
      const response = await fetch(
        `/api/inventory/items/${encodeURIComponent(item.id)}/responsibility/accept`,
        { method: "POST", credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("accept_failed");
      setAction({ status: "accepted" });
      setItem((current) =>
        current
          ? { ...current, isAssigned: true, isCurrentUserResponsible: true }
          : current,
      );
    } catch {
      setAction({ status: "error" });
    } finally {
      actionInFlight.current = false;
    }
  }

  async function requestTransferToSelf() {
    if (!item?.responsibleId || actionInFlight.current) return;
    actionInFlight.current = true;
    setAction({ status: "submitting" });
    transferKey.current ??= `scan-transfer:${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/inventory/transfer-requests", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "idempotency-key": transferKey.current,
        },
        body: JSON.stringify({
          recipientId: item.responsibleId,
          itemIds: [item.id],
          requestKind: "claim",
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          transferKey.current = null;
        }
        throw new Error("request_failed");
      }
      const result = parseCreateTmcTransferRequestResult(
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as { result?: unknown }).result
          : null,
      );
      const requestId = result.request?.id;
      if (
        !requestId ||
        !result.items.some(
          (entry) => entry.itemId === item.id && entry.outcome === "included",
        )
      ) {
        transferKey.current = null;
        throw new Error("request_rejected");
      }
      transferKey.current = null;
      setAction({ status: "requested", requestId });
    } catch {
      setAction({ status: "error" });
    } finally {
      actionInFlight.current = false;
    }
  }

  function scanAgain() {
    setItem(null);
    setMessage("");
    setAction({ status: "idle" });
    transferKey.current = null;
    setMode("item");
  }

  if (mode === "room") {
    return (
      <InventoryRoomQrScanner
        onClose={() => setMode(null)}
        onRoomResolved={(room) => router.push(`/rooms/${room.id}`)}
        hintKey="scanner.openRoomHint"
      />
    );
  }

  const canClaim = actorRole === "employee";
  const itemActive = item?.status === "active";
  const assignedToOther =
    item?.isAssigned === true && item.isCurrentUserResponsible !== true;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ScanLine className="h-7 w-7 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold">{t("nav.scanQr")}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {t("scanner.itemHint")}
            </p>
          </div>
        </div>

        {message ? (
          <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {message}
          </p>
        ) : null}

        {!item ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("item")}
              className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-900 disabled:opacity-50"
            >
              <Barcode className="h-8 w-8" />
              {t("scanner.itemTitle")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("room")}
              className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 font-semibold text-zinc-800 disabled:opacity-50"
            >
              <MapPinned className="h-8 w-8" />
              {t("scanner.roomTitle")}
            </button>
          </div>
        ) : null}

        {busy ? <p role="status" className="mt-4 text-center text-sm text-zinc-500">{t("tmc.qr.resolving")}</p> : null}

        {item ? (
          <ScannedItemDetailsCard
            item={item}
            actions={
              <div>
                {action.status === "error" ? (
                  <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                    {t("tmc.operation.error")}
                  </p>
                ) : null}
                {action.status === "accepted" || item.isCurrentUserResponsible ? (
                  <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                    {t("tmc.operation.receiveSuccess")}
                  </p>
                ) : action.status === "requested" ? (
                  <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
                    <a href={`/tmc/transfer-requests/${encodeURIComponent(action.requestId)}`} className="underline">
                      {t("tmc.operation.requestSuccess")}
                    </a>
                  </p>
                ) : canClaim && itemActive && assignedToOther && !item.localGroup ? (
                  <div>
                    <p className="text-sm text-zinc-600">
                      {t("tmc.operation.occupiedHint")}
                    </p>
                    <button
                      type="button"
                      disabled={
                        action.status === "submitting" || !item.responsibleId
                      }
                      onClick={() => void requestTransferToSelf()}
                      className="mt-3 min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {action.status === "submitting" ? t("tmc.operation.submitting") : t("tmc.operation.requestTransfer")}
                    </button>
                  </div>
                ) : canClaim && itemActive && !item.isAssigned ? (
                  <div>
                    <button
                      type="button"
                      disabled={action.status === "submitting"}
                      onClick={() => void acceptFreeItem()}
                      className="mt-3 min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {action.status === "submitting" ? t("tmc.operation.submitting") : t("tmc.operation.acceptItem")}
                    </button>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={scanAgain}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t("tmc.qr.scanAgain")}
                </button>
              </div>
            }
          />
        ) : null}
      </section>

      {mode === "item" ? (
        <InventoryItemCodeScanner
          onClose={() => setMode(null)}
          onCodeSelected={(value) => void resolveItemCode(value)}
        />
      ) : null}
    </main>
  );
}
