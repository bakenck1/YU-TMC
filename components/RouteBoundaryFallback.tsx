"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import {
  getClientLanguage,
  getServerLanguage,
  subscribeToClientLanguage,
} from "@/lib/client-language";
import { translate, type TranslationKey } from "@/lib/i18n";

interface RouteBoundaryFallbackProps {
  error?: Error & { digest?: string };
  retry: () => void;
  global?: boolean;
}

export default function RouteBoundaryFallback({
  error,
  retry,
  global = false,
}: RouteBoundaryFallbackProps) {
  const language = useSyncExternalStore(
    subscribeToClientLanguage,
    getClientLanguage,
    getServerLanguage,
  );

  useEffect(() => {
    const digest = typeof error?.digest === "string" ? error.digest : undefined;
    console.error("route_boundary_error", {
      digest,
      kind: error ? "render_error" : "unknown_error",
    });
  }, [error]);

  const titleKey: TranslationKey = global ? "error.globalTitle" : "error.title";
  const descriptionKey: TranslationKey = global
    ? "error.globalDescription"
    : "error.description";

  const BoundaryContainer = global ? "main" : "div";

  return (
    <BoundaryContainer
      className={`flex items-center justify-center bg-background px-4 py-10 text-foreground ${
        global ? "min-h-screen" : "min-h-[calc(100vh-7rem)]"
      }`}
      aria-labelledby="route-boundary-title"
    >
      <section
        aria-labelledby="route-boundary-title"
        className="w-full max-w-lg rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm sm:p-8"
      >
        <div role="alert" aria-live="assertive">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 id="route-boundary-title" className="mt-5 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
            {translate(language, titleKey)}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-600">
            {translate(language, descriptionKey)}
          </p>
        </div>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {translate(language, "error.retry")}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {translate(language, "error.reload")}
          </button>
        </div>
      </section>
    </BoundaryContainer>
  );
}
