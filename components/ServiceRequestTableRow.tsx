import Image from "next/image";
import Link from "next/link";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { useAppSettings } from "./AppSettingsProvider";
import ServiceRequestStatusControl from "./ServiceRequestStatusControl";

export interface ServiceRequestTableRowProps { request: ServiceRequestDto; canManage: boolean; saving: boolean; onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void; locale: string }

export default function ServiceRequestTableRow({ request, canManage, saving, onStatus, locale }: ServiceRequestTableRowProps) {
  const { t } = useAppSettings();
  return <tr className="border-b border-black/5 align-top last:border-0"><td className="p-4 font-medium">{t(`request.type.${request.type}`)}</td><td className="p-4"><Link className="font-medium text-[#002060] hover:underline" href={`/items/${request.item.id}`}>{request.item.name}</Link><p className="text-xs text-zinc-500">{request.item.inventoryNumber}</p></td><td className="p-4">{request.room.buildingName} · {request.room.designation}</td><td className="p-4">{request.author.name}</td><td className="p-4">{request.responsible?.name ?? t("common.notAssigned")}</td><td className="max-w-xs p-4">{request.description}</td><td className="p-4"><Image src={request.photoUrl} alt={t("request.photo")} width={96} height={72} unoptimized className="h-16 w-24 rounded-lg object-cover" /></td><td className="p-4"><ServiceRequestStatusControl request={request} canManage={canManage} saving={saving} onStatus={onStatus} /></td><td className="whitespace-nowrap p-4 text-zinc-500">{new Date(request.updatedAt).toLocaleString(locale)}</td></tr>;
}
