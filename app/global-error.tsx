"use client";

import { useSyncExternalStore } from "react";
import RouteBoundaryFallback from "@/components/RouteBoundaryFallback";
import {
  getClientLanguage,
  getServerLanguage,
  subscribeToClientLanguage,
} from "@/lib/client-language";
import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const language = useSyncExternalStore(
    subscribeToClientLanguage,
    getClientLanguage,
    getServerLanguage,
  );

  return (
    <html lang={language}>
      <head>
        <title>YU Inventory</title>
      </head>
      <body style={{ margin: 0, fontFamily: "Arial, Helvetica, sans-serif" }}>
        <RouteBoundaryFallback error={error} retry={unstable_retry} global />
      </body>
    </html>
  );
}
