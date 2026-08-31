import { Barcode, Clock3, MapPin, Package, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import Wrapper from "@/components/Wrapper";
import { isUuid } from "@/lib/domain/identifiers";
import { getApplicationServices } from "@/lib/server/application";
import { readHiddenPageResource } from "@/lib/server/security/hidden-page-resource";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { authorizationActor } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_LABELS = {
  created: "Создание локального кода",
  split: "Отделение части группы",
  transferred: "Передача всей группы",
  cancelled: "Отмена локального кода",
} as const;

export default async function LocalBarcodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuthorizedPage(`/local-barcodes/${id}`);
  if (!isUuid(id)) notFound();
  const actor = authorizationActor(user);
  const [group, history] = await readHiddenPageResource(
    () =>
      Promise.all([
        getApplicationServices().localBarcodes.getGroup(id, actor),
        getApplicationServices().localBarcodes.getHistory(id, actor),
      ]),
    notFound,
  );

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
            {group.status === "active" || user.role !== "employee" ? (
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
          <Detail icon={Barcode} label="Исходный штрихкод 1С" value={group.originalBarcode} code />
          <Detail icon={Barcode} label="Локальный штрихкод" value={group.localBarcode} code />
          <Detail icon={Package} label="Количество" value={String(group.quantity)} />
          <Detail icon={UserRound} label="Ответственный" value={group.responsible.fullName} />
          <Detail icon={Clock3} label="Дата передачи" value={new Date(group.transferredAt).toLocaleString("ru-RU")} />
          <Detail icon={MapPin} label="Местонахождение" value={`${group.location.buildingName} · ${group.location.roomDesignation}`} />
        </dl>
      </section>

      {group.status === "active" || user.role !== "employee" ? (
        <LocalBarcodeDistributionPanel
          itemId={group.itemId}
          actorId={user.userId}
          actorRole={user.role}
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

function Detail({
  icon: Icon,
  label,
  value,
  code = false,
}: {
  icon: typeof Barcode;
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
