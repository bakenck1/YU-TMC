"use client";

import { Barcode, MapPinned, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import InventoryRoomQrScanner from "@/components/InventoryRoomQrScanner";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";

export default function QrScanPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"item" | "room" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function resolveItemCode(value: string) {
    setMode(null);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(value)}&kind=barcode&target=item`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as {
        resolution?: QrResolutionDto;
      };
      const resolution = body.resolution;
      if (!response.ok || !resolution?.target || resolution.target.kind !== "item") {
        throw new Error();
      }
      if (resolution.target.localGroup) {
        router.push(`/local-barcodes/${resolution.target.localGroup.id}`);
      } else if (resolution.distribution) {
        router.push(`/local-barcodes/item/${resolution.target.id}`);
      } else if (resolution.status === "resolved") {
        router.push(`/items/${resolution.target.id}`);
      } else {
        throw new Error();
      }
    } catch {
      setMessage("Штрихкод не найден или у вас нет доступа к этой ТМЦ.");
      setBusy(false);
    }
  }

  if (mode === "room") {
    return (
      <InventoryRoomQrScanner
        onClose={() => setMode(null)}
        onRoomResolved={(room) => router.push(`/rooms/${room.id}`)}
        hintKey="scanner.openRoomHint"
      />
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ScanLine className="h-7 w-7 text-emerald-600" />
          <div>
            <h1 className="text-xl font-bold">Сканирование</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Выберите штрих-код ТМЦ или QR-код кабинета.
            </p>
          </div>
        </div>

        {message ? (
          <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {message}
          </p>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("item")}
            className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-900 disabled:opacity-50"
          >
            <Barcode className="h-8 w-8" />
            Штрих-код ТМЦ
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("room")}
            className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 font-semibold text-zinc-800 disabled:opacity-50"
          >
            <MapPinned className="h-8 w-8" />
            QR-код кабинета
          </button>
        </div>
        {busy ? <p className="mt-4 text-center text-sm text-zinc-500">Поиск ТМЦ…</p> : null}
      </section>

      {mode === "item" ? (
        <InventoryItemCodeScanner
          onClose={() => setMode(null)}
          onCodeSelected={(value) => void resolveItemCode(value)}
        />
      ) : null}
    </main>
  );
}
