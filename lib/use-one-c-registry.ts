"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RegistryPage<T> = { data: T[]; page: number; pageSize: number; total: number };

export function useOneCRegistry<T>(endpoint: string, revision?: string | null) {
  const [page, setPage] = useState<RegistryPage<T> | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async (number: number, searchValue: string) => {
    const requestId = ++generation.current;
    setBusy(true); setError(null);
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const params = new URLSearchParams({ page: String(number), pageSize: "50", search: searchValue.trim() });
      const response = await fetch(`${endpoint}${separator}${params}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("registry_unavailable");
      const result = await response.json() as RegistryPage<T>;
      if (!Array.isArray(result.data) || !Number.isSafeInteger(result.total) || result.total < 0
        || !Number.isSafeInteger(result.page) || result.page < 1 || !Number.isSafeInteger(result.pageSize) || result.pageSize < 1) throw new Error("registry_invalid");
      if (requestId === generation.current) { setPage(result); setAppliedSearch(searchValue); }
    } catch {
      if (requestId === generation.current) setError("Не удалось загрузить список. Повторите попытку.");
    } finally { if (requestId === generation.current) setBusy(false); }
  }, [endpoint]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setSearch(""); void load(1, ""); } });
    return () => { cancelled = true; invalidate(); };
  }, [load, revision, invalidate]);

  return { page, search, setSearch, appliedSearch, busy, error, load };
}
