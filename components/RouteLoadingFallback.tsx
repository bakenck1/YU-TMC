"use client";

import { LoaderCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  getClientLanguage,
  getServerLanguage,
  subscribeToClientLanguage,
} from "@/lib/client-language";
import { translate } from "@/lib/i18n";

export default function RouteLoadingFallback() {
  const language = useSyncExternalStore(
    subscribeToClientLanguage,
    getClientLanguage,
    getServerLanguage,
  );

  return (
    <div
      className="flex min-h-[calc(100vh-7rem)] items-center justify-center bg-background px-4 py-10 text-foreground"
      aria-busy="true"
      aria-live="polite"
    >
      <section className="w-full max-w-2xl rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8" role="status">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded-full bg-zinc-100" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded-full bg-zinc-100" />
          </div>
          <LoaderCircle className="h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-zinc-50" />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-zinc-500">{translate(language, "common.loading")}</p>
      </section>
    </div>
  );
}
