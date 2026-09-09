"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Paperclip, Send } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAppSettings } from "@/components/AppSettingsProvider";
import { localizeItemError, responseErrorCode } from "@/components/InventoryItemDetailsPresentation";
import type { InventoryItemCommentDto } from "@/lib/contracts/inventory-items";

export default function InventoryItemComments({
  itemId,
  initialComments,
  canComment,
}: {
  itemId: string;
  initialComments: InventoryItemCommentDto[];
  canComment: boolean;
}) {
  const { locale, t } = useAppSettings();
  const router = useRouter();
  const {
    comments,
    comment,
    setComment,
    attachment,
    setAttachment,
    saving,
    error,
    attachmentInputRef,
    submit,
  } = useInventoryItemComments({
    itemId,
    initialComments,
    refresh: () => router.refresh(),
    localizeError: (error) => localizeItemError(error, t),
  });

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-sky-600" />
        <h2 className="text-lg font-semibold text-zinc-800">
          {t("itemDetails.comments")} ({comments.length})
        </h2>
      </div>
      {canComment ? (
        <form className="mt-4 space-y-2" onSubmit={submit}>
          <label className="sr-only" htmlFor="item-comment">
            {t("itemDetails.commentPlaceholder")}
          </label>
          <textarea
            id="item-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t("itemDetails.commentPlaceholder")}
            className="min-h-12 flex-1 resize-y rounded-xl border border-black/10 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-zinc-600">
              <Paperclip className="h-4 w-4" />
              {t("itemDetails.commentAttach")}
              <input
                ref={attachmentInputRef}
                id="item-comment-attachment"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="sr-only"
                onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
              />
            </label>
            {attachment ? <span className="text-xs text-zinc-500">{attachment.name}</span> : null}
            <button
              type="submit"
              disabled={saving || !comment.trim()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {saving ? t("itemDetails.saving") : t("itemDetails.commentSend")}
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {comments.length ? (
        <ol className="mt-4 space-y-3">
          {comments.map((entry) => (
            <li key={entry.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-zinc-800">
                  {entry.authorName}
                  {entry.authorEmail ? <span className="font-normal text-zinc-400">· {entry.authorEmail}</span> : null}
                </p>
                <time dateTime={entry.createdAt} className="text-xs text-zinc-400">
                  {new Date(entry.createdAt).toLocaleString(locale)}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-zinc-600">{entry.message}</p>
              {entry.attachment ? (
                <a href={entry.attachment.downloadUrl} className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:underline">
                  <Paperclip className="h-4 w-4" />
                  {entry.attachment.fileName}
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-sm text-zinc-500">
          {t("itemDetails.commentsEmpty")}
        </p>
      )}
    </section>
  );
}

export function useInventoryItemComments({
  itemId,
  initialComments,
  refresh,
  localizeError,
}: {
  itemId: string;
  initialComments: InventoryItemCommentDto[];
  refresh: () => void;
  localizeError: (error: unknown) => string;
}) {
  const [comments, setComments] = useState(initialComments);
  const [comment, setComment] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, [itemId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim() || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("message", comment);
      if (attachment) formData.set("attachment", attachment);
      const response = await fetch(`/api/inventory/items/${itemId}/comments`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
      const body = await response.json().catch(() => ({})) as {
        comments?: InventoryItemCommentDto[];
        error?: string;
      };
      if (!response.ok || !body.comments) {
        throw new Error(body.error ?? responseErrorCode(response.status));
      }
      if (request.signal.aborted) return;
      setComments(body.comments);
      setComment("");
      setAttachment(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      refresh();
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(localizeError(cause));
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setSaving(false);
      }
    }
  }

  return {
    comments,
    comment,
    setComment,
    attachment,
    setAttachment,
    saving,
    error,
    attachmentInputRef,
    submit,
  };
}
