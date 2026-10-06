"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import PassportFileLinks from "@/components/PassportFileLinks";
import { MAX_PASSPORT_BYTES, PASSPORT_REJECTION_REASONS, type PassportAction, type PassportRejectionReason, type RoomPassportDto } from "@/lib/contracts/room-passports";
import type { TranslationKey } from "@/lib/i18n";
import { passportReturnHref } from "@/lib/room-passport-list-state";

const STAGES = ["not_started", "in_progress", "in_review", "approved"] as const;
const ACTIVE_STAGE_STYLES = {
  not_started: "bg-[#002060] text-white",
  in_progress: "bg-[#002060] text-white",
  in_review: "bg-orange-100 text-orange-900 ring-1 ring-orange-300",
  approved: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
};
const ERRORS: Record<string, TranslationKey> = {
  passport_conflict: "passport.conflict", passport_invalid_pdf: "passport.invalidPdf", payload_too_large: "passport.invalidPdf",
  passport_rejection_required: "passport.rejectionRequired", passport_action_unavailable: "passport.unavailableAction",
  passport_pdf_busy: "passport.pdfBusy",
};
export default function RoomPassportCard({ initialPassport, viewerId, returnHref }: {
  initialPassport: RoomPassportDto;
  viewerId?: string;
  returnHref?: string;
}) {
  const { t, dataLabel } = useAppSettings();
  const [passport, setPassport] = useState(initialPassport);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [reason, setReason] = useState<PassportRejectionReason | "">("");
  const [comment, setComment] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState<PassportRejectionReason | "">("");
  const [returnComment, setReturnComment] = useState("");
  const returnReasonRef = useRef<HTMLSelectElement>(null);
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const returnFormId = useId();
  useEffect(() => { if (returnOpen) returnReasonRef.current?.focus(); }, [returnOpen]);
  function closeReturn() {
    setReturnOpen(false); setReturnReason(""); setReturnComment("");
  }
  function cancelReturn() { closeReturn(); returnButtonRef.current?.focus(); }
  const root = `/api/room-passports/${passport.roomId}`;
  const step = passport.status === "needs_correction" ? 1 : STAGES.indexOf(passport.status);
  const needsCorrection = passport.status === "needs_correction";
  const actionButtons = passport.actions
    .filter(action => action !== "upload" && action !== "reject" && action !== "return" && action !== "delete")
    .sort((left, right) => Number(right === "approve") - Number(left === "approve"));

  async function perform(action?: PassportAction, file?: File) {
    if (busyRef.current) return;
    if (action === "return" && (!returnReason || (returnReason === "other" && !returnComment.trim()))) {
      setError("passport.rejectionRequired"); return;
    }
    if (file && (!file.size || file.size > MAX_PASSPORT_BYTES)) { setError("passport.invalidPdf"); return; }
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`${root}${file ? "/file" : ""}`, {
        method: action ? "POST" : "GET", cache: "no-store",
        headers: file ? { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name), "X-Passport-Version": String(passport.version) } : action ? { "Content-Type": "application/json" } : undefined,
        body: file ?? (action ? JSON.stringify({ action, version: passport.version, ...(action === "reject" ? { reason, comment } : action === "return" ? { reason: returnReason, comment: returnComment } : {}) }) : undefined),
      });
      const payload = await response.json();
      if (!response.ok) { setError(ERRORS[payload.error] ?? "passport.error"); return; }
      setPassport(payload.passport);
      closeReturn();
      if (action === "reject" || action === "approve") { setReason(""); setComment(""); }
    } catch { setError("passport.error"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <main className="mx-auto max-w-4xl space-y-5 pb-24 md:pb-6" aria-busy={busy}>
    <Link href={passportReturnHref(returnHref)} className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-800">← {t("passport.back")}</Link>
    <section className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-5 sm:p-7">
      <h1 className="text-2xl font-bold text-[#002060]">{t("passport.roomTitle")}: {passport.designation}</h1>
      <p className="text-zinc-600">{dataLabel(passport.buildingName)} · {t("passport.floor")}: {passport.floorLabel ?? passport.floorNumber}</p>
      <ol aria-label={t("passport.status")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((stage, index) => <li key={stage} aria-current={index === step ? "step" : undefined} className={`rounded-xl p-3 text-sm ${index === step ? `${needsCorrection ? "bg-red-100 text-red-900 ring-1 ring-red-300" : ACTIVE_STAGE_STYLES[stage]} font-semibold` : index < step ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>{index + 1}. {t(needsCorrection && index === step ? "passport.status.needs_correction" : `passport.status.${stage}`)}</li>)}
      </ol>
      {needsCorrection ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-900">{t("passport.correctionHint")}</p> : null}
      {passport.rejectionReason ? <aside className={`rounded-2xl border p-4 ${needsCorrection ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <h2 className="font-semibold">{t("passport.lastRemark")}</h2><p>{t(`passport.reason.${passport.rejectionReason}`)}</p>
        {passport.rejectionComment ? <p className="mt-2 whitespace-pre-wrap break-words">{passport.rejectionComment}</p> : null}
      </aside> : null}
      {passport.file ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"><PassportFileLinks file={passport.file} /></div> : <p className="text-sm text-zinc-500">{t("passport.noFile")}</p>}
      {passport.status === "in_review" && !passport.actions.includes("approve") ? <div role="status" className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
        <p className="font-semibold">{t("passport.submittedThanks")}</p>
        <p className="text-sm">{t(viewerId && viewerId === passport.submittedBy ? "passport.waitingResult" : "passport.waitingSenderResult")}</p>
      </div> : null}
      {passport.actions.includes("approve") ? <p className="text-sm text-zinc-600">{t("passport.reviewHint")}</p> : null}
      {passport.status === "in_progress" && passport.rejectionReason && passport.file ? <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">{t("passport.correctionSaved")}</p> : null}
      {passport.actions.includes("upload") && !needsCorrection ? <p className="text-sm text-zinc-500">{t("passport.pdfHint")}</p> : null}
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t(error)}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {actionButtons.map(action => <button key={action} type="button" disabled={busy || returnOpen || error === "passport.conflict"} onClick={() => void perform(action)} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${action === "approve" ? "bg-emerald-700 px-7 text-white hover:bg-emerald-800 focus-visible:outline-emerald-700" : "bg-[#002060] text-white hover:bg-blue-900 focus-visible:outline-blue-700"}`}>
          {action === "approve" ? <Check size={20} aria-hidden="true" /> : null}
          {t(`passport.action.${action}`)}
        </button>)}
        {passport.actions.includes("return") ? <button ref={returnButtonRef} type="button" aria-expanded={returnOpen} aria-controls={returnFormId} disabled={busy || error === "passport.conflict"} onClick={() => { if (returnOpen) cancelReturn(); else setReturnOpen(true); }} className="min-h-12 rounded-xl border border-zinc-300 bg-white px-5 text-base font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50">{t("passport.action.return")}</button> : null}
        <button type="button" disabled={busy} onClick={() => void perform()} className="min-h-12 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50 sm:ml-auto">{t("passport.refresh")}</button>
      </div>
      {returnOpen && passport.actions.includes("return") ? <form id={returnFormId} aria-labelledby={`${returnFormId}-title`} onSubmit={event => { event.preventDefault(); void perform("return"); }} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
        <h2 id={`${returnFormId}-title`} className="font-semibold text-zinc-900">{t("passport.returnTitle")}</h2>
        <p className="text-sm text-zinc-700">{t(passport.status === "approved" ? "passport.returnApprovedHint" : "passport.returnReviewHint")}</p>
        <label className="block space-y-1 text-sm font-semibold"><span>{t("passport.returnReason")}</span><select ref={returnReasonRef} required disabled={busy} value={returnReason} onChange={event => setReturnReason(event.target.value as PassportRejectionReason)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"><option value="">{t("passport.chooseReason")}</option>{PASSPORT_REJECTION_REASONS.map(value => <option key={value} value={value}>{t(`passport.reason.${value}`)}</option>)}</select></label>
        <label className="block space-y-1 text-sm font-semibold"><span>{t("passport.comment")}</span><textarea value={returnComment} onChange={event => setReturnComment(event.target.value)} maxLength={1000} required={returnReason === "other"} disabled={busy} rows={3} className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-base" /></label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" disabled={busy} onClick={cancelReturn} className="min-h-12 rounded-xl border border-zinc-300 bg-white px-5 font-semibold text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50">{t("passport.cancel")}</button>
          <button type="submit" disabled={busy || !returnReason || (returnReason === "other" && !returnComment.trim()) || error === "passport.conflict"} className="min-h-12 rounded-xl bg-amber-800 px-5 font-semibold text-white hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:cursor-not-allowed disabled:opacity-50">{t("passport.confirmReturn")}</button>
        </div>
      </form> : null}
      {passport.actions.includes("upload") ? <label className="block space-y-2 text-sm font-semibold text-zinc-800">
        <span>{t(needsCorrection ? "passport.uploadCorrection" : "passport.action.upload")}</span><input type="file" accept="application/pdf,.pdf" disabled={busy || error === "passport.conflict"} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void perform("upload", file); }} className="block min-h-11 w-full rounded-xl border border-zinc-200 p-2 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:p-2 file:text-sm sm:text-sm" />
      </label> : null}
      {!returnOpen && passport.actions.includes("reject") ? <form onSubmit={event => { event.preventDefault(); void perform("reject"); }} className="space-y-3 rounded-2xl border border-red-100 bg-red-50/40 p-4">
        <label className="block space-y-1 text-sm font-semibold"><span>{t("passport.reason")}</span><select required disabled={busy} value={reason} onChange={event => setReason(event.target.value as PassportRejectionReason)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"><option value="">{t("passport.chooseReason")}</option>{PASSPORT_REJECTION_REASONS.map(value => <option key={value} value={value}>{t(`passport.reason.${value}`)}</option>)}</select></label>
        <label className="block space-y-1 text-sm font-semibold"><span>{t("passport.comment")}</span><textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} required={reason === "other"} disabled={busy} rows={3} className="w-full rounded-xl border border-zinc-200 p-3 text-base" /></label>
        <button type="submit" disabled={busy || !reason || (reason === "other" && !comment.trim()) || error === "passport.conflict"} className="min-h-12 w-full rounded-xl bg-red-700 px-5 text-base font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{t("passport.action.reject")}</button>
      </form> : null}
    </section>
  </main>;
}
