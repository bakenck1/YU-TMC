"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { addSearchHistoryEntry, parseSearchHistory } from "@/lib/search-history";
import { useAppSettings } from "./AppSettingsProvider";

export interface InventoryFilterInputProps { label: string; value: string; onChange: (value: string) => void; historyStorageKey?: string }

function loadHistory(storageKey: string) { try { return parseSearchHistory(window.localStorage.getItem(storageKey)); } catch { return []; } }
function saveHistory(storageKey: string, history: string[]) { try { window.localStorage.setItem(storageKey, JSON.stringify(history)); } catch { /* Embedded webviews may deny storage. */ } }

export default function InventoryFilterInput({ label, value, onChange, historyStorageKey }: InventoryFilterInputProps) {
  const { t } = useAppSettings();
  const [history, setHistory] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const blurTimeoutRef = useRef<number | null>(null);
  const visibleHistory = useMemo(() => { const query = value.trim().toLocaleLowerCase(); return query ? history.filter((entry) => entry.toLocaleLowerCase().includes(query)) : history; }, [history, value]);

  useEffect(() => { if (!historyStorageKey) return; const timeout = window.setTimeout(() => setHistory(loadHistory(historyStorageKey)), 0); return () => window.clearTimeout(timeout); }, [historyStorageKey]);
  useEffect(() => () => { if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current); }, []);

  function rememberValue() { const nextValue = value.trim(); if (!nextValue || !historyStorageKey) return; setHistory((current) => { const next = addSearchHistoryEntry(current, nextValue); saveHistory(historyStorageKey, next); return next; }); }
  function selectValue(entry: string) { onChange(entry); setFocused(false); setHistory((current) => { const next = addSearchHistoryEntry(current, entry); if (historyStorageKey) saveHistory(historyStorageKey, next); return next; }); }

  return (
    <div className="relative text-sm text-zinc-600" onFocus={() => { if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current); setFocused(true); }} onBlur={(event) => { if (event.currentTarget.contains(event.relatedTarget)) return; rememberValue(); blurTimeoutRef.current = window.setTimeout(() => setFocused(false), 0); }}>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-zinc-500">{label}</label>
      <input id={inputId} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") rememberValue(); if (event.key === "Escape") setFocused(false); }} className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 outline-none focus:border-accent" />
      {focused && visibleHistory.length ? <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg"><div className="px-3 py-2 text-xs text-zinc-500">{t("items.recentSearches")}</div><ul className="border-t border-black/5 py-1">{visibleHistory.map((entry) => <li key={entry}><button type="button" onClick={() => selectValue(entry)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"><Search className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> {entry}</button></li>)}</ul></div> : null}
    </div>
  );
}
