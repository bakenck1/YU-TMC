"use client";

import { MapPin, QrCode, RotateCcw, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import TmcUserPicker from "@/components/TmcUserPicker";
import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";
import type { TmcOperationNavigation } from "@/lib/tmc-navigation";
import {
  TmcItemQrResolverController,
  installTmcQrResolverController,
  type TmcQrFlowState,
} from "@/lib/tmc-qr-resolver";

const ERROR_KEYS = {
  invalid_code: "tmc.qr.invalidCode",
  not_item: "tmc.qr.notItem",
  item_unavailable: "tmc.qr.itemUnavailable",
  request_failed: "tmc.qr.requestFailed",
} as const satisfies Record<
  Extract<TmcQrFlowState, { status: "error" }>["reason"],
  TranslationKey
>;

export default function TmcItemQrFlow({
  operation,
}: {
  operation: TmcOperationNavigation;
}) {
  const { t } = useAppSettings();
  const [scannerOpen, setScannerOpen] = useState(true);
  const [flowState, setFlowState] = useState<TmcQrFlowState>({ status: "idle" });
  const [recipient, setRecipient] = useState<TmcOperationUserDto | null>(null);
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const resolverRef = useRef<TmcItemQrResolverController | null>(null);

  useEffect(() =>
    installTmcQrResolverController(resolverRef, {
      fetcher: (url, init) => fetch(url, init),
      onState: setFlowState,
    }), []);
  useEffect(() => {
    if (!scannerOpen && flowState.status === "idle") {
      scanButtonRef.current?.focus();
    }
  }, [flowState.status, scannerOpen]);

  async function resolveCode(value: string) {
    setScannerOpen(false);
    await resolverRef.current?.resolve(value);
  }

  function scanAgain() {
    resolverRef.current?.reset();
    setRecipient(null);
    setScannerOpen(true);
  }

  function removeItem() {
    resolverRef.current?.reset();
    setRecipient(null);
  }

  const item = flowState.status === "selected" ? flowState.item : null;
  const location = item
    ? [item.buildingName, item.roomDesignation].filter(Boolean).join(" · ")
    : "";

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
        {t(operation.labelKey)}
      </h2>

      {flowState.status === "resolving" ? (
        <p role="status" className="mt-5 text-sm text-zinc-600">
          {t("tmc.qr.resolving")}
        </p>
      ) : null}

      {flowState.status === "error" ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p role="alert" className="text-sm text-amber-900">{t(ERROR_KEYS[flowState.reason])}</p>
          <button type="button" onClick={scanAgain} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("tmc.qr.scanAgain")}
          </button>
        </div>
      ) : null}

      {item ? (
        <article className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4" aria-live="polite">
          <div className="flex items-start gap-3">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-zinc-900">{item.title}</h3>
              {item.inventoryNumber ? <p className="mt-1 text-sm text-zinc-600">{item.inventoryNumber}</p> : null}
              {location ? <p className="mt-3 flex items-center gap-2 text-sm text-zinc-700"><MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />{location}</p> : null}
              <p className="mt-2 flex items-center gap-2 text-sm text-zinc-700"><UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />{item.responsibleName || t("tmc.qr.noResponsible")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={scanAgain} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("tmc.qr.scanAgain")}
            </button>
            <button type="button" onClick={removeItem} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700">
              <X className="h-4 w-4" aria-hidden="true" />
              {t("tmc.qr.remove")}
            </button>
          </div>
        </article>
      ) : null}

      {item && operation.id !== "receive" ? (
        <TmcUserPicker value={recipient} onChange={setRecipient} />
      ) : null}

      {flowState.status === "idle" && !scannerOpen ? (
        <button ref={scanButtonRef} type="button" onClick={() => setScannerOpen(true)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark">
          <QrCode className="h-4 w-4" aria-hidden="true" />
          {t("tmc.qr.scan")}
        </button>
      ) : null}

      {scannerOpen ? (
        <InventoryItemCodeScanner
          mode="qr-only"
          onClose={() => setScannerOpen(false)}
          onCodeSelected={(value) => void resolveCode(value)}
        />
      ) : null}
    </section>
  );
}
