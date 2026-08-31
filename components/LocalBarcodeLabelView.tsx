"use client";

import { Download, Printer } from "lucide-react";
import Image from "next/image";
import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";

export default function LocalBarcodeLabelView({
  group,
}: {
  group: LocalBarcodeGroupDto;
}) {
  const labelUrl = `/api/inventory/local-barcodes/${group.id}/label`;
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-6 bg-white p-6">
      <div className="print:hidden">
        <h1 className="text-center text-xl font-semibold">Этикетка локальной группы</h1>
        <p className="mt-1 text-center font-mono text-sm text-zinc-600">
          {group.localBarcode}
        </p>
      </div>
      <Image
        src={labelUrl}
        alt={`Code 39: ${group.localBarcode}`}
        width={1000}
        height={500}
        unoptimized
        priority
        className="h-auto w-full max-w-[900px]"
      />
      <div className="flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white"
        >
          <Printer className="h-4 w-4" /> Печать
        </button>
        <a
          href={`${labelUrl}?download=1`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-4 font-semibold"
        >
          <Download className="h-4 w-4" /> Скачать SVG
        </a>
      </div>
    </main>
  );
}
