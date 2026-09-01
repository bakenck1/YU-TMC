import { Barcode, Clock3, MapPin, Package, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import Wrapper from "@/components/Wrapper";
import type {
  LocalBarcodeGroupDto,
  LocalBarcodeHistoryEventDto,
} from "@/lib/contracts/local-barcodes";
import type { UserRole } from "@/lib/contracts/users";

const EVENT_LABELS = {
  created: "Создание локального кода",
  split: "Отделение части группы",
  transferred: "Передача всей группы",
  cancelled: "Отмена локального кода",
} as const;

export interface LocalBarcodeGroupDetailsProps {
  group: LocalBarcodeGroupDto;
  history: LocalBarcodeHistoryEventDto[];
  actorId: string;
  actorRole: UserRole;
}

export default function LocalBarcodeGroupDetails({
  group,
  history,
  actorId,
  actorRole,
}: LocalBarcodeGroupDetailsProps) {
  const canOpenDistribution = group.status === "active" || actorRole !== "employee";

  return (
    <Wrapper direction="column" gap="md">
      <section className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-emerald-700">Локальная группа ТМЦ</p>
            <h1 className="mt-1 text-2xl font-bold text-zinc-950">{group.itemName}</h1>
            <p className="mt-2 font-mono text-lg font-semibold text-emerald-800">
              {group.localBarcode}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canOpenDistribution ? (
              <Link
                href={`/local-barcodes/item/${group.itemId}`}
                className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4 font-semibold"
              >
                Открыть распределение
              </Link>
            ) : null}
            <Link
              href={`/local-barcodes/${group.id}/label`}
              className="inline-flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 font-semibold text-white"
            >
              Печать этикетки
            </Link>
          </div>
        </div>

        {group.status === "cancelled" ? (
          <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            <strong>Код отменён.</strong> {group.cancellation?.reason}
            <div className="mt-1 text-sm">
              {group.cancellation
                ? `${group.cancellation.administrator.fullName}, ${new Date(group.cancellation.cancelledAt).toLocaleString("ru-RU")}`
                : null}
            </div>
          </div>
        ) : null}

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <LocalBarcodeDetail icon={Barcode} label="Исходный штрихкод 1С" value={group.originalBarcode} code />
          <LocalBarcodeDetail icon={Barcode} label="Локальный штрихкод" value={group.localBarcode} code />
          <LocalBarcodeDetail icon={Package} label="Количество" value={String(group.quantity)} />
          <LocalBarcodeDetail icon={UserRound} label="Ответственный" value={group.responsible.fullName} />
          <LocalBarcodeDetail icon={Clock3} label="Дата передачи" value={new Date(group.transferredAt).toLocaleString("ru-RU")} />
          <LocalBarcodeDetail icon={MapPin} label="Местонахождение" value={`${group.location.buildingName} · ${group.location.roomDesignation}`} />
        </dl>
      </section>

      {canOpenDistribution ? (
        <LocalBarcodeDistributionPanel
          itemId={group.itemId}
          actorId={actorId}
          actorRole={actorRole}
        />
      ) : null}

      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">История</h2>
        <ol className="mt-4 space-y-3">
          {history.map((event) => (
            <li key={event.id} className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{EVENT_LABELS[event.type]}</strong>
                <time className="text-sm text-zinc-500">{new Date(event.occurredAt).toLocaleString("ru-RU")}</time>
              </div>
              <p className="mt-2 text-sm text-zinc-700">
                {event.fromResponsible?.fullName ?? "Без ответственного"} →{" "}
                {event.toResponsible?.fullName ?? "Предыдущая группа"}; количество: {event.quantity}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {event.location.buildingName} · {event.location.roomDesignation} · оформил: {event.actor.fullName}
              </p>
              {event.reason ? <p className="mt-2 text-sm text-red-700">Причина: {event.reason}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </Wrapper>
  );
}

export function LocalBarcodeDetail({
  icon: Icon,
  label,
  value,
  code = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="rounded-xl bg-zinc-50 p-4">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <Icon className="h-4 w-4" /> {label}
      </dt>
      <dd className={`mt-2 text-zinc-900 ${code ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
