"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { MapPin, Package, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import { parseTmcTransferRequest } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";
import {
  buildTmcRequestDecisions,
  createTmcRequestSelection,
  shouldRetainTmcDecisionAttempt,
  toggleTmcRequestSelection,
} from "@/lib/tmc-transfer-request-card";
import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";

const STATUS_KEYS = {
  pending: "tmc.request.status.pending",
  accepted: "tmc.request.status.accepted",
  rejected: "tmc.request.status.rejected",
  cancelled: "tmc.request.status.cancelled",
} as const satisfies Record<TmcTransferRequestCardView["status"], TranslationKey>;

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-900",
  accepted: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-zinc-100 text-zinc-700",
} as const satisfies Record<TmcTransferRequestCardView["status"], string>;

const ITEM_RESULT_KEYS = {
  pending: "tmc.request.item.pending",
  accepted: "tmc.request.item.accepted",
  rejected: "tmc.request.item.rejected",
  cancelled: "tmc.request.item.cancelled",
  invalidated: "tmc.request.item.invalidated",
} as const satisfies Record<TmcTransferRequestCardView["items"][number]["result"], TranslationKey>;

export default function TmcTransferRequestCard({
  request,
  canDecide,
  canCancel = false,
  showOverdue,
  requiresAdministrativeReason,
  requiresCancellationReason = false,
}: {
  request: TmcTransferRequestCardView;
  canDecide: boolean;
  canCancel?: boolean;
  showOverdue: boolean;
  requiresAdministrativeReason: boolean;
  requiresCancellationReason?: boolean;
}) {
  const { t, language } = useAppSettings();
  const router = useRouter();
  const [selection, setSelection] = useState<ReadonlySet<string>>(() =>
    createTmcRequestSelection(request, canDecide),
  );
  const [administrativeReason, setAdministrativeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "success"; accepted: number; total: number }
    | { kind: "error"; message: TranslationKey }
    | null
  >(null);
  const submissionSequence = useRef(0);
  const inFlight = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const logicalAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const cancellationAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const administrativeReasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => {
    submissionSequence.current += 1;
    abortController.current?.abort();
  }, []);
  const locale = language === "kk" ? "kk-KZ" : language === "en" ? "en-US" : "ru-RU";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "KZT" });
  const createdAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(request.createdAt));
  const pendingItems = request.items.filter((item) => item.result === "pending");

  async function cancelRequest() {
    if (inFlight.current) return;
    const reason = requiresCancellationReason
      ? window.prompt(t("tmc.request.administrativeReason"))
      : null;
    if (requiresCancellationReason && !reason?.trim()) return;
    if (!window.confirm(t("tmc.request.cancelConfirm"))) return;
    const payload = {
      requestVersion: request.version,
      ...(reason ? { administrativeReason: reason } : {}),
    };
    const fingerprint = JSON.stringify(payload);
    if (!cancellationAttempt.current || cancellationAttempt.current.fingerprint !== fingerprint) {
      cancellationAttempt.current = {
        fingerprint,
        key: `tmc-cancel:${crypto.randomUUID()}`,
      };
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/inventory/transfer-requests/${request.id}/cancel`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": cancellationAttempt.current.key },
        body: fingerprint,
      });
      if (!response.ok) {
        if (response.status < 500 && response.status !== 409 && response.status !== 429) {
          cancellationAttempt.current = null;
        }
        throw new Error("cancel_failed");
      }
      cancellationAttempt.current = null;
      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: "tmc.request.cancelError" });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function submitDecision(mode: "all" | "selected" | "reject") {
    if (inFlight.current || pendingItems.length === 0) return;
    if (mode === "reject" && !window.confirm(t("tmc.request.rejectAllConfirm"))) return;
    if (
      mode === "selected" &&
      selection.size === 0 &&
      !window.confirm(t("tmc.request.rejectAllConfirm"))
    ) return;
    if (requiresAdministrativeReason && !administrativeReason.trim()) {
      setFeedback({ kind: "error", message: "tmc.request.administrativeReasonRequired" });
      administrativeReasonRef.current?.focus();
      return;
    }
    const payload = {
      requestVersion: request.version,
      decisions: buildTmcRequestDecisions(request, selection, mode),
      ...(requiresAdministrativeReason ? { administrativeReason } : {}),
    };
    const fingerprint = JSON.stringify(payload);
    if (!logicalAttempt.current || logicalAttempt.current.fingerprint !== fingerprint) {
      logicalAttempt.current = {
        fingerprint,
        key: `tmc-decision:${crypto.randomUUID()}`,
      };
    }
    const sequence = ++submissionSequence.current;
    inFlight.current = true;
    setSubmitting(true);
    setFeedback(null);
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const response = await fetch(
        `/api/inventory/transfer-requests/${request.id}/decision`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "idempotency-key": logicalAttempt.current.key,
          },
          body: fingerprint,
          signal: controller.signal,
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !("request" in body)) {
        const errorCode = body && typeof body === "object" && "error" in body
          ? String(body.error)
          : "decision_failed";
        if (sequence !== submissionSequence.current) return;
        if (errorCode === "idempotency_request_in_progress") {
          setFeedback({ kind: "error", message: "tmc.request.decisionInProgress" });
          return;
        }
        if (!shouldRetainTmcDecisionAttempt(response.status, errorCode)) {
          logicalAttempt.current = null;
        }
        if (response.status === 409) {
          setFeedback({ kind: "error", message: "tmc.request.decisionStale" });
          router.refresh();
          return;
        }
        throw new Error(errorCode);
      }
      const updated = parseTmcTransferRequest(body.request);
      if (sequence !== submissionSequence.current) return;
      logicalAttempt.current = null;
      setFeedback({
        kind: "success",
        accepted: updated.summary.accepted,
        total: updated.summary.total,
      });
      router.refresh();
    } catch (error) {
      if (sequence === submissionSequence.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setFeedback({ kind: "error", message: "tmc.request.decisionError" });
      }
    } finally {
      if (sequence === submissionSequence.current) {
        inFlight.current = false;
        abortController.current = null;
        setSubmitting(false);
      }
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="tmc-request-title">
      <header className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="tmc-request-title" className="text-2xl font-semibold text-zinc-900">{t("tmc.request.title")}</h1>
            <p className="mt-1 break-all text-xs text-zinc-500">{request.id}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLES[request.status]}`}>{t(STATUS_KEYS[request.status])}</span>
        </div>
        {canCancel && request.status === "pending" ? <button type="button" disabled={submitting} onClick={() => void cancelRequest()} className="mt-4 min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-50">{t("tmc.request.cancel")}</button> : null}
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <Meta label={t("tmc.request.initiator")} value={`${request.initiator.fullName} · ${request.initiator.email}`} />
          <Meta label={t("tmc.request.recipient")} value={`${request.recipient.fullName} · ${request.recipient.email}`} />
          <div><dt className="font-medium text-zinc-500">{t("tmc.request.createdAt")}</dt><dd className="mt-1 text-zinc-900"><time dateTime={request.createdAt}>{createdAt}</time></dd></div>
          <Meta label={t("tmc.request.summary")} value={`${request.summary.pending} / ${request.summary.total}`} />
        </dl>
        {showOverdue && request.overdue ? <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{t("tmc.request.overdue")}</p> : null}
        {request.status === "accepted" || request.status === "rejected" ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-900">{t("tmc.request.result").replace("{accepted}", String(request.summary.accepted)).replace("{total}", String(request.summary.total))}</p> : null}
        <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm">
          <p className="font-medium text-zinc-500">{t("tmc.request.comment")}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800">{request.comment || t("tmc.request.noComment")}</p>
        </div>
      </header>

      <div className="space-y-3">
        {request.items.map((item, index) => {
          const selectable = canDecide && item.result === "pending";
          const checked = selectable && selection.has(item.id);
          const checkboxId = `tmc-request-item-${item.id}`;
          return (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <label htmlFor={checkboxId} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={checked}
                    disabled={!selectable}
                    aria-label={`${t("tmc.request.selectItem")} ${item.item.name}`}
                    onChange={() => setSelection((current) => toggleTmcRequestSelection(current, item, canDecide))}
                    className="h-5 w-5 accent-emerald-700"
                  />
                </label>
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                  {item.item.photoUrl ? (
                    <Image src={item.item.photoUrl} alt="" fill unoptimized className="object-cover" sizes="80px" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-zinc-400" aria-label={t("tmc.request.noPhoto")}><Package className="h-7 w-7" aria-hidden="true" /></span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-semibold text-zinc-900">{index + 1}. {item.item.name}</h2>
                  <p className="mt-1 text-xs font-semibold text-zinc-600">{t(ITEM_RESULT_KEYS[item.result])}</p>
                  <p className="mt-1 break-all text-sm text-zinc-500">{item.item.inventoryNumber}</p>
                  <p className="mt-2 flex items-start gap-2 text-sm text-zinc-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{item.item.location.buildingName} · {item.item.location.roomDesignation}</p>
                  <p className="mt-2 flex items-start gap-2 text-sm text-zinc-700"><UserRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{t("tmc.request.currentResponsible")}: {item.responsibleUserProfile.fullName}</span></p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-3 text-sm sm:grid-cols-3">
                <Meta label={t("tmc.request.quantity")} value={String(item.item.quantity)} />
                <Meta label={t("tmc.request.unitPrice")} value={money.format(item.item.unitPrice)} />
                <Meta label={t("tmc.request.totalPrice")} value={money.format(item.item.quantity * item.item.unitPrice)} />
              </dl>
            </article>
          );
        })}
      </div>
      {canDecide && pendingItems.length > 0 && feedback?.kind !== "success" ? (
        <div aria-busy={submitting} className="sticky bottom-3 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-xl backdrop-blur">
          {requiresAdministrativeReason ? (
            <label className="block text-sm font-semibold text-zinc-800">
              {t("tmc.request.administrativeReason")}
              <textarea
                ref={administrativeReasonRef}
                value={administrativeReason}
                onChange={(event) => {
                  setAdministrativeReason(event.target.value);
                  if (feedback?.kind === "error" && feedback.message === "tmc.request.administrativeReasonRequired") setFeedback(null);
                }}
                required
                aria-invalid={feedback?.kind === "error" && feedback.message === "tmc.request.administrativeReasonRequired"}
                aria-describedby={feedback?.kind === "error" && feedback.message === "tmc.request.administrativeReasonRequired" ? "tmc-administrative-reason-error" : undefined}
                maxLength={1000}
                rows={3}
                className="mt-2 w-full rounded-xl border border-zinc-200 p-3 font-normal outline-none focus:border-emerald-500"
              />
              {feedback?.kind === "error" && feedback.message === "tmc.request.administrativeReasonRequired" ? <span id="tmc-administrative-reason-error" role="alert" className="mt-1 block font-normal text-red-700">{t(feedback.message)}</span> : null}
            </label>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button type="button" disabled={submitting} onClick={() => void submitDecision("all")} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("tmc.request.acceptAll")}</button>
            <button type="button" disabled={submitting} onClick={() => void submitDecision("selected")} className="min-h-11 rounded-xl border border-emerald-700 bg-white px-4 text-sm font-semibold text-emerald-800 disabled:opacity-50">{t("tmc.request.acceptSelected")}</button>
            <button type="button" disabled={submitting} onClick={() => void submitDecision("reject")} className="min-h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 disabled:opacity-50">{t("tmc.request.rejectAll")}</button>
          </div>
        </div>
      ) : null}
      {feedback?.kind === "success" ? (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-900">{t("tmc.request.result").replace("{accepted}", String(feedback.accepted)).replace("{total}", String(feedback.total))}</p>
      ) : feedback?.kind === "error" && feedback.message !== "tmc.request.administrativeReasonRequired" ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{t(feedback.message)}</p>
      ) : null}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-900">{value}</dd></div>;
}
