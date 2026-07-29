"use client";

import { Download, Printer } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

export default function InventoryQrPrintView({
  item,
  copies = 1,
}: {
  item: InventoryItemDto;
  copies?: number;
}) {
  const qrUrl = `/api/inventory/items/${item.id}/qr?format=svg`;
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white p-6 text-zinc-900 sm:p-10">
      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          <Printer className="h-4 w-4" /> Печать
        </button>
        <a
          href={`/api/inventory/items/${item.id}/qr?format=png&download=1`}
          className="flex items-center gap-2 rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold"
        >
          <Download className="h-4 w-4" /> Скачать PNG
        </a>
        <Link
          href={`/items/${item.id}`}
          className="rounded-lg border border-black/10 px-4 py-2 text-sm"
        >
          Назад к предмету
        </Link>
      </div>
      <div className="grid gap-5 print:gap-0">
        {Array.from({ length: copies }, (_, index) => (
      <section key={index} className="mx-auto flex aspect-[3/2] w-full max-w-[148mm] items-center gap-8 rounded-xl border-2 border-zinc-900 p-8 print:break-after-page print:border-black">
        <Image
          src={qrUrl}
          alt={`QR-код: ${item.name}`}
          width={280}
          height={280}
          unoptimized
          priority
          className="h-auto w-[45%]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            YU Inventory
          </p>
          <h1 className="mt-3 break-words text-2xl font-bold">{item.name}</h1>
          <dl className="mt-5 space-y-2 text-sm">
            <div>
              <dt className="text-zinc-500">Тип ТМЦ</dt>
              <dd className="font-semibold">{item.itemType}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Инвентарный номер</dt>
              <dd className="font-semibold">{item.inventoryNumber}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Локация</dt>
              <dd className="font-semibold">
                {item.room.buildingName}, {item.room.designation}
              </dd>
            </div>
          </dl>
          <p className="mt-5 break-all font-mono text-[10px] text-zinc-500">
            {item.qrCode}
          </p>
        </div>
      </section>
        ))}
      </div>
    </main>
  );
}
