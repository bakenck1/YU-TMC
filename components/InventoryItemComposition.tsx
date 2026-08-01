"use client";

import { Boxes, Link2, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

export default function InventoryItemComposition({
  itemId,
  initialComponents,
  canManage,
}: {
  itemId: string;
  initialComponents: InventoryItemDto[];
  canManage: boolean;
}) {
  const { t } = useAppSettings();
  const router = useRouter();
  const [components, setComponents] = useState(initialComponents);
  const [candidates, setCandidates] = useState<InventoryItemDto[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const linkedIds = useMemo(
    () => new Set(components.map((component) => component.id)),
    [components],
  );
  const available = useMemo(
    () => candidates.filter((candidate) => !linkedIds.has(candidate.id)),
    [candidates, linkedIds],
  );

  useEffect(() => {
    if (!modalOpen) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingCandidates(true);
      setModalError("");
      try {
        const params = new URLSearchParams({ q: query.trim() });
        const response = await fetch(
          `/api/inventory/items/${itemId}/components/candidates?${params}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as {
          candidates?: InventoryItemDto[];
          error?: string;
        };
        if (!response.ok || !body.candidates) {
          throw new Error(body.error ?? "item_components_unavailable");
        }
        setCandidates(body.candidates);
      } catch (candidateError) {
        if (!(candidateError instanceof DOMException && candidateError.name === "AbortError")) {
          setModalError(t("itemComposition.error"));
        }
      } finally {
        if (!controller.signal.aborted) setLoadingCandidates(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [itemId, modalOpen, query, t]);

  function openModal() {
    setQuery("");
    setSelectedId("");
    setCandidates([]);
    setError("");
    setModalError("");
    setLoadingCandidates(true);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    window.requestAnimationFrame(() => openButtonRef.current?.focus());
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function mutate(componentId: string, method: "POST" | "DELETE") {
    setSaving(true);
    setError("");
    setModalError("");
    try {
      const response = await fetch(`/api/inventory/items/${itemId}/components`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ componentId }),
      });
      const body = (await response.json()) as {
        components?: InventoryItemDto[];
        error?: string;
      };
      if (!response.ok || !body.components) {
        throw new Error(body.error ?? "item_components_unavailable");
      }
      setComponents(body.components);
      router.refresh();
      if (method === "POST") closeModal();
    } catch {
      const message = t("itemComposition.error");
      if (modalOpen) setModalError(message);
      else setError(message);
    } finally {
      setSaving(false);
    }
  }

  const addButton = (insideEmptyState = false) =>
    canManage ? (
      <button
        ref={openButtonRef}
        type="button"
        onClick={openModal}
        className={
          insideEmptyState
            ? "mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            : "inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        }
      >
        <Plus className="h-4 w-4" />
        {t("itemComposition.add")}
      </button>
    ) : null;

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-800">
            <Boxes className="h-5 w-5 text-emerald-600" />
            {t("itemComposition.title")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("itemComposition.hint")}
          </p>
        </div>
        {components.length ? addButton() : null}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {components.length ? (
        <div className="mt-5">
          <p className="font-semibold text-zinc-700">
            {t("itemComposition.installed")}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {t("itemComposition.installedHint")}
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {components.map((component) => (
              <li key={component.id} className="group relative rounded-xl border border-black/5 bg-slate-50 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                <Link
                  href={`/items/${component.id}`}
                  className="flex min-h-24 items-start gap-3 p-4 pr-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-zinc-800">
                      {component.name}
                    </span>
                    <span className="mt-1 block text-sm text-zinc-500">
                      {[component.itemType, component.brand].filter(Boolean).join(" · ")}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-zinc-500">
                      {component.inventoryNumberKind === "temporary"
                        ? t("itemComposition.unmarked")
                        : component.inventoryNumber}
                    </span>
                  </span>
                </Link>
                {canManage ? (
                  <button
                    type="button"
                    aria-label={t("itemComposition.remove", { name: component.name })}
                    title={t("itemComposition.remove", { name: component.name })}
                    disabled={saving}
                    onClick={() => void mutate(component.id, "DELETE")}
                    className="absolute right-3 top-3 rounded-lg p-2 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-5 flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-5 text-center">
          <Boxes className="h-10 w-10 text-emerald-300" />
          <p className="mt-3 font-semibold text-zinc-700">
            {t("itemComposition.empty")}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {t("itemComposition.emptyHint")}
          </p>
          {addButton(true)}
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) closeModal();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-composition-dialog-title"
            aria-describedby="item-composition-dialog-description"
            onKeyDown={handleDialogKeyDown}
            className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="item-composition-dialog-title" className="text-lg font-semibold text-zinc-800">
                  {t("itemComposition.selectTitle")}
                </h3>
                <p id="item-composition-dialog-description" className="mt-1 text-sm text-zinc-500">
                  {t("itemComposition.selectHint")}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("common.close")}
                disabled={saving}
                onClick={closeModal}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="relative mt-4 block">
              <span className="sr-only">{t("common.search")}</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-zinc-400" />
              <input
                autoFocus
                value={query}
                maxLength={100}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                }}
                placeholder={t("itemComposition.searchPlaceholder")}
                className="w-full rounded-xl border border-black/10 py-2.5 pl-10 pr-3 outline-none focus:border-emerald-500"
              />
            </label>
            {modalError ? (
              <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {modalError}
              </p>
            ) : null}
            <div className="mt-4 min-h-40 flex-1 overflow-y-auto">
              {loadingCandidates ? (
                <p className="py-12 text-center text-sm text-zinc-500">
                  {t("common.loading")}…
                </p>
              ) : available.length ? (
                <fieldset className="space-y-2">
                  <legend className="sr-only">{t("itemComposition.selectTitle")}</legend>
                  {available.map((candidate) => (
                    <label key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-black/5 p-3 hover:bg-slate-50">
                      <input
                        type="radio"
                        name="component"
                        value={candidate.id}
                        checked={selectedId === candidate.id}
                        onChange={() => setSelectedId(candidate.id)}
                        className="mt-1 accent-emerald-600"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-zinc-800">{candidate.name}</span>
                        <span className="block text-sm text-zinc-500">
                          {[candidate.itemType, candidate.brand].filter(Boolean).join(" · ")}
                        </span>
                        <span className="block font-mono text-xs text-zinc-400">
                          {candidate.inventoryNumberKind === "temporary"
                            ? t("itemComposition.unmarked")
                            : candidate.inventoryNumber}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="py-12 text-center text-sm text-zinc-500">
                  {t("itemComposition.noResults")}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-black/5 pt-4">
              <button type="button" disabled={saving} onClick={closeModal} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50">
                {t("common.cancel")}
              </button>
              <button type="button" disabled={!selectedId || saving} onClick={() => void mutate(selectedId, "POST")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <Plus className="h-4 w-4" />
                {saving ? t("itemDetails.saving") : t("itemComposition.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
