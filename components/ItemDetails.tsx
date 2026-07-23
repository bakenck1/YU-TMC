"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckSquare,
  Edit3,
  Info,
  QrCode,
  Save,
  Send,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { InventoryItem } from "@/lib/types";

type DetailTab = "info" | "edit" | "service" | "writeoff" | "delete";

const tabs = [
  { id: "info" as const, label: "Информация", icon: Info },
  { id: "edit" as const, label: "Редактировать", icon: Edit3 },
  { id: "service" as const, label: "Отправить в сервис", icon: Wrench },
  { id: "writeoff" as const, label: "Списать", icon: CheckSquare },
  { id: "delete" as const, label: "Удалить", icon: Trash2 },
];

function splitLocation(value: string) {
  const [object, ...rest] = value.split(" / ");
  return { object, room: rest.join(" / ") || "—" };
}

function AssetCard({ item }: { item: InventoryItem }) {
  const location = splitLocation(item.location);
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-100 bg-[#fff8ec]">
      <div className="relative aspect-[4/3] w-full bg-zinc-100">
        {item.photo ? <Image src={item.photo} alt={item.name} fill priority sizes="(max-width: 768px) 100vw, 420px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-zinc-400">Фотография пока не добавлена</div>}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-5 border-t border-amber-100 p-5">
        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-black/10 pb-3"><span>Тип ТМЦ</span><span className="text-zinc-600">Электроника</span></div>
          <div className="flex justify-between gap-4 border-b border-black/10 pb-3"><span>Объект</span><span className="text-zinc-600">{location.object}</span></div>
          <div className="flex justify-between gap-4 border-b border-black/10 pb-3"><span>Локация</span><span className="text-zinc-600">{location.room}</span></div>
          <div className="flex justify-between gap-4"><span>Ответственный</span><span className="text-right text-zinc-600">{item.responsible || "Не назначен"}</span></div>
        </div>
        <div className="hidden text-center sm:block">
          <QrCode className="mx-auto h-24 w-24 text-zinc-700" strokeWidth={1.5} />
          <button type="button" className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600">Создать QR-код</button>
        </div>
      </div>
    </div>
  );
}

const operations = [
  ["Перемещение на объект", "ТМЦ перемещено с 32 мкр (D212) на объект 32 мкр", "27 апреля 2025, 08:49"],
  ["Принятие", "ТМЦ принято ответственным сотрудником", "27 апреля 2025, 08:49"],
  ["Перемещение на объект", "ТМЦ перемещено с локации D304 в D212", "27 апреля 2025, 08:43"],
  ["Принятие", "ТМЦ принят без дополнительного подтверждения", "27 апреля 2025, 08:43"],
  ["Создание", "Создана карточка ТМЦ", "27 апреля 2025, 08:38"],
];

function InformationPanel() {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-lg font-semibold text-zinc-800">Последние операции (5)</h2>
      <div className="space-y-0">
        {operations.map(([title, description, date], index) => (
          <div key={`${title}-${date}`} className="relative flex gap-4 pb-6 last:pb-0">
            {index < operations.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-emerald-200" />}
            <span className="relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-emerald-500 bg-white" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col justify-between gap-1 sm:flex-row"><p className="font-medium text-zinc-800">{title}</p><time className="text-xs text-zinc-400">{date}</time></div>
              <p className="mt-1 text-sm text-zinc-500">{description}</p>
              <p className="mt-2 text-sm font-medium text-zinc-700">Demo User · legacy-user@example.test</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditPanel({ item }: { item: InventoryItem }) {
  const location = splitLocation(item.location);
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Редактировать ТМЦ</h2><p className="mt-1 text-sm text-zinc-500">Измените основную информацию об объекте.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[["Тип ТМЦ", "Электроника"], ["Название", item.itemType ?? item.name], ["Бренд / модель", item.brandModel ?? item.name], ["QR Code", item.qrCode ?? item.inventoryNumber], ["Инвентарный номер", item.inventoryNumber], ["Цена", (item.price ?? 0).toFixed(2)], ["Объект", location.object], ["Локация", location.room]].map(([label, value]) => <label key={label} className="rounded-xl bg-slate-100 px-4 py-3 text-xs text-zinc-400">{label}<input defaultValue={value} className="mt-1 block w-full bg-transparent text-sm text-zinc-800 outline-none" /></label>)}
      </div>
      <button type="button" className="mt-6 flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white"><Save className="h-4 w-4" />Сохранить</button>
    </section>
  );
}

function ActionPanel({ type }: { type: Exclude<DetailTab, "info" | "edit"> }) {
  const content = {
    service: { title: "Отправить ТМЦ в сервис", text: "Укажите сервисный центр и причину отправки.", button: "Отправить в сервис", Icon: Send },
    writeoff: { title: "Списание ТМЦ", text: "После подтверждения объект будет отмечен как списанный.", button: "Списать", Icon: CheckSquare },
    delete: { title: "Удаление ТМЦ", text: "После удаления карточку и историю объекта нельзя будет восстановить.", button: "Удалить", Icon: Trash2 },
  }[type];
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-7 shadow-sm">
      <div className="mx-auto max-w-xl text-center"><content.Icon className={`mx-auto h-20 w-20 ${type === "delete" ? "text-red-400" : "text-emerald-400"}`} strokeWidth={1.2} /><h2 className="mt-4 text-xl font-semibold">{content.title}</h2><p className="mt-2 text-zinc-500">{content.text}</p></div>
      {type === "service" ? <div className="mx-auto mt-7 max-w-xl space-y-4"><input placeholder="Название сервиса" className="w-full rounded-xl bg-slate-100 px-4 py-3 outline-none" /><textarea placeholder="Причина" rows={4} className="w-full resize-none rounded-xl bg-slate-100 px-4 py-3 outline-none" /></div> : <label className="mx-auto mt-7 flex max-w-xl items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-emerald-500" />Я подтверждаю это действие</label>}
      <button type="button" className={`mx-auto mt-6 flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white ${type === "delete" ? "bg-red-500" : "bg-emerald-500"}`}><content.Icon className="h-4 w-4" />{content.button}</button>
    </section>
  );
}

export default function ItemDetails({ item }: { item: InventoryItem }) {
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const statusStyles =
    item.displayStatus === "Не распределено"
      ? "bg-zinc-100 text-zinc-500"
      : item.displayStatus === "Маркировано"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-violet-100 text-violet-600";

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-black/5 bg-white p-2">
        {tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${activeTab === tab.id ? "bg-emerald-50 text-emerald-700" : "text-zinc-500 hover:bg-zinc-50"}`}><Icon className="h-4 w-4" />{tab.label}</button>; })}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-500" /><strong>ТМЦ не промаркировано.</strong> Создайте и отсканируйте QR-код.</span></div>
      <div className="flex items-center gap-3"><Link href="/items" className="rounded-lg p-2 text-zinc-500 hover:bg-white"><ArrowLeft className="h-5 w-5" /></Link><div><h1 className="text-2xl font-semibold text-zinc-800">{item.itemType ?? item.name} {item.brandModel ?? ""}</h1><span className={`mt-1 inline-block rounded px-2 py-1 text-xs font-medium ${statusStyles}`}>{item.displayStatus ?? "Активен"}</span></div></div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.85fr)_minmax(520px,1.6fr)]">
        <AssetCard item={item} />
        {activeTab === "info" ? <InformationPanel /> : activeTab === "edit" ? <EditPanel item={item} /> : <ActionPanel type={activeTab} />}
      </div>
      <div className="rounded-2xl border border-black/5 bg-white p-6"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-emerald-500" /><h2 className="font-semibold">Комплектация</h2></div><p className="mt-4 text-sm text-zinc-400">Комплектация пока не добавлена.</p></div>
    </div>
  );
}
