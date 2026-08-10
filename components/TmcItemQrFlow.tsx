"use client";

import { Barcode, MapPin, RotateCcw, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import TmcUserPicker from "@/components/TmcUserPicker";
import {
  parseCreateTmcTransferRequestResult,
  type TmcOperationUserDto,
} from "@/lib/contracts/tmc-operations";
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
  fallback,
}: {
  operation: TmcOperationNavigation;
  fallback?: ReactNode;
}) {
  const { t } = useAppSettings();
  const [scannerOpen, setScannerOpen] = useState(true);
  const [flowState, setFlowState] = useState<TmcQrFlowState>({ status: "idle" });
  const [recipient, setRecipient] = useState<TmcOperationUserDto | null>(null);
  const [comment, setComment] = useState("");
  const [submission, setSubmission] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "success"; requestId?: string }
    | { status: "error" }
  >({ status: "idle" });
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const resolverRef = useRef<TmcItemQrResolverController | null>(null);
  const submissionSequence = useRef(0);
  const submissionAbortController = useRef<AbortController | null>(null);
  const submissionInFlight = useRef(false);
  const createAttempt = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

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
  useEffect(() => () => {
    submissionSequence.current += 1;
    submissionAbortController.current?.abort();
  }, []);

  async function resolveCode(value: string) {
    setScannerOpen(false);
    await resolverRef.current?.resolve(value);
  }

  function scanAgain() {
    resolverRef.current?.reset();
    setRecipient(null);
    setComment("");
    resetSubmission();
    createAttempt.current = null;
    setScannerOpen(true);
  }

  function removeItem() {
    resolverRef.current?.reset();
    setRecipient(null);
    setComment("");
    resetSubmission();
    createAttempt.current = null;
  }

  function resetSubmission() {
    submissionSequence.current += 1;
    submissionAbortController.current?.abort();
    submissionAbortController.current = null;
    submissionInFlight.current = false;
    setSubmission({ status: "idle" });
  }

  async function submitOperation() {
    const item = flowState.status === "selected" ? flowState.item : null;
    if (!item || submissionInFlight.current) return;
    if (operation.id !== "receive" && !recipient) return;

    submissionInFlight.current = true;
    const sequence = ++submissionSequence.current;
    const controller = new AbortController();
    submissionAbortController.current?.abort();
    submissionAbortController.current = controller;
    setSubmission({ status: "submitting" });

    try {
      if (operation.id === "receive") {
        const response = await fetch(
          `/api/inventory/items/${encodeURIComponent(item.id)}/responsibility/accept`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("tmc_receive_failed");
        if (sequence === submissionSequence.current) setSubmission({ status: "success" });
        return;
      }

      const payload = {
        recipientId: recipient!.id,
        itemIds: [item.id],
        ...(comment.trim() ? { comment } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (!createAttempt.current || createAttempt.current.fingerprint !== fingerprint) {
        createAttempt.current = {
          fingerprint,
          key: `tmc-create:${crypto.randomUUID()}`,
        };
      }
      const response = await fetch("/api/inventory/transfer-requests", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "idempotency-key": createAttempt.current.key,
        },
        body: fingerprint,
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const errorCode = body && typeof body === "object" && !Array.isArray(body)
          ? (body as { error?: unknown }).error
          : null;
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429 &&
          errorCode !== "idempotency_request_in_progress"
        ) {
          createAttempt.current = null;
        }
        throw new Error("tmc_transfer_request_failed");
      }
      const result = parseCreateTmcTransferRequestResult(
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as { result?: unknown }).result
          : null,
      );
      const requestId = result.request?.id;
      const included = result.items.some(
        (outcome) => outcome.outcome === "included" && outcome.itemId === item.id,
      );
      if (!requestId || !included) {
        createAttempt.current = null;
        throw new Error("tmc_transfer_request_rejected");
      }
      if (sequence === submissionSequence.current) {
        createAttempt.current = null;
        setSubmission({ status: "success", requestId });
      }
    } catch (error) {
      if (
        sequence === submissionSequence.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setSubmission({ status: "error" });
      }
    } finally {
      if (sequence === submissionSequence.current) {
        submissionAbortController.current = null;
        submissionInFlight.current = false;
      }
    }
  }

  const item = flowState.status === "selected" ? flowState.item : null;
  const location = item
    ? [item.buildingName, item.roomDesignation].filter(Boolean).join(" · ")
    : "";
  const receiveAlreadyAssigned =
    operation.id === "receive" && item?.isCurrentUserResponsible === true;
  const receiveUnavailable =
    operation.id === "receive" &&
    !receiveAlreadyAssigned &&
    Boolean(item?.responsibleName?.trim());

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
            <Barcode className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
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

      {item && submission.status !== "success" && !receiveAlreadyAssigned && !receiveUnavailable ? (
        <div aria-busy={submission.status === "submitting"} className="mt-5 space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          {operation.id !== "receive" ? (
            <label className="block text-sm font-semibold text-zinc-800">
              {t("tmc.operation.comment")}
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={1000}
                rows={3}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-3 font-normal outline-none focus:border-emerald-500"
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={submission.status === "submitting" || (operation.id !== "receive" && !recipient)}
            onClick={() => void submitOperation()}
            className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submission.status === "submitting"
              ? t("tmc.operation.submitting")
              : t(operation.id === "receive" ? "tmc.operation.acceptItem" : "tmc.operation.sendRequest")}
          </button>
        </div>
      ) : null}

      {submission.status === "success" || receiveAlreadyAssigned ? (
        submission.status === "success" && submission.requestId ? (
          <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-900">
            <a href={`/tmc/transfer-requests/${encodeURIComponent(submission.requestId)}`} className="underline">{t("tmc.operation.requestSuccess")}</a>
          </p>
        ) : (
          <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-900">{t("tmc.operation.receiveSuccess")}</p>
        )
      ) : receiveUnavailable ? (
        <p role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t("tmc.operation.receiveUnavailable")}</p>
      ) : submission.status === "error" ? (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{t("tmc.operation.error")}</p>
      ) : null}

      {flowState.status === "idle" && !scannerOpen ? (
        <>
          <button ref={scanButtonRef} type="button" onClick={() => setScannerOpen(true)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark">
            <Barcode className="h-4 w-4" aria-hidden="true" />
            {t("tmc.qr.scan")}
          </button>
          {fallback}
        </>
      ) : null}

      {scannerOpen ? (
        <InventoryItemCodeScanner
          onClose={() => setScannerOpen(false)}
          onCodeSelected={(value) => void resolveCode(value)}
        />
      ) : null}
    </section>
  );
}
