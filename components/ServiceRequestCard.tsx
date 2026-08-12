import Image from "next/image";
import Link from "next/link";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { useAppSettings } from "./AppSettingsProvider";
import ServiceRequestStatusControl from "./ServiceRequestStatusControl";

export interface ServiceRequestCardProps { request: ServiceRequestDto; canManage: boolean; saving: boolean; onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void }

export default function ServiceRequestCard({ request, canManage, saving, onStatus }: ServiceRequestCardProps) {
  const { t } = useAppSettings();
  return <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm"><div className="relative aspect-[16/9]"><Image src={request.photoUrl} alt={t("request.photo")} fill sizes="100vw" unoptimized className="object-cover" /></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-amber-700">{t(`request.type.${request.type}`)}</p><Link href={`/items/${request.item.id}`} className="mt-1 block text-lg font-semibold text-zinc-900">{request.item.name}</Link><p className="text-sm text-zinc-500">{request.item.inventoryNumber}</p></div><ServiceRequestStatusControl request={request} canManage={canManage} saving={saving} onStatus={onStatus} /></div><p className="mt-4 text-base leading-6 text-zinc-700">{request.description}</p><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt className="text-zinc-500">{t("itemDetails.room")}</dt><dd className="text-right">{request.room.designation}</dd><dt className="text-zinc-500">{t("request.author")}</dt><dd className="text-right">{request.author.name}</dd><dt className="text-zinc-500">{t("room.responsible")}</dt><dd className="text-right">{request.responsible?.name ?? t("common.notAssigned")}</dd><dt className="text-zinc-500">{t("request.createdAt")}</dt><dd className="text-right">{new Date(request.createdAt).toLocaleDateString()}</dd></dl></div></article>;
}
