"use client";

import {
  Barcode,
  Download,
  Printer,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import TmcUserPicker from "@/components/TmcUserPicker";
import type {
  LocalBarcodeDistributionDto,
  LocalBarcodeGroupDto,
} from "@/lib/contracts/local-barcodes";
import type {
  CreateTmcTransferRequestResultDto,
  TmcOperationUserDto,
} from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";

type Source = {
  groupId: string | null;
  label: string;
  available: number;
  version: number;
  returnRecipient: LocalBarcodeGroupDto["previousResponsible"];
};

export default function LocalBarcodeDistributionPanel({
  itemId,
  actorId,
  actorRole,
}: {
  itemId: string;
  actorId: string;
  actorRole: UserRole;
}) {
  const router = useRouter();
  const [distribution, setDistribution] =
    useState<LocalBarcodeDistributionDto | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [recipient, setRecipient] = useState<TmcOperationUserDto | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<LocalBarcodeGroupDto | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/inventory/local-barcodes?itemId=${encodeURIComponent(itemId)}`,
      { cache: "no-store" },
    );
    const body = (await response.json().catch(() => ({}))) as {
      distribution?: LocalBarcodeDistributionDto;
      error?: string;
    };
    if (!response.ok || !body.distribution) {
      setMessage(localError(body.error));
      return;
    }
    setDistribution(body.distribution);
  }, [itemId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function openTransfer(next: Source) {
    setSource(next);
    setRecipient(null);
    setQuantity(String(Math.min(1, next.available)));
    setMessage("");
    setCreated(null);
    setRequestId(null);
    attemptKey.current = null;
  }

  async function submit() {
    const recipientId = source?.returnRecipient?.id ?? recipient?.id;
    if (!source || !recipientId) return;
    const parsedQuantity = Number(quantity);
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > source.available
    ) {
      setMessage("Укажите допустимое количество.");
      return;
    }

    setBusy(true);
    setMessage("");
    attemptKey.current ??= `local-transfer:${crypto.randomUUID()}`;
    try {
      const response = await fetch(actorRole === "admin"
        ? "/api/inventory/local-barcodes"
        : "/api/inventory/transfer-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": attemptKey.current,
        },
        body: JSON.stringify(actorRole === "admin" ? {
          itemId,
          sourceGroupId: source.groupId,
          recipientUserId: recipientId,
          quantity: parsedQuantity,
          sourceVersion: source.version,
        } : {
          recipientId,
          itemIds: [itemId],
          quantityTransfers: [{
            itemId,
            sourceLocalGroupId: source.groupId,
            sourceVersion: source.version,
            quantity: parsedQuantity,
          }],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        result?: ({
          group: LocalBarcodeGroupDto;
          createdNewCode: boolean;
        } | CreateTmcTransferRequestResultDto);
        error?: string;
      };
      if (!response.ok || !body.result) throw new Error(localError(body.error));

      if (actorRole !== "admin") {
        const requestResult = body.result as CreateTmcTransferRequestResultDto;
        if (!requestResult.request || requestResult.included < 1) {
          throw new Error("Не удалось создать заявку на передачу.");
        }
        setRequestId(requestResult.request.id);
        setCreated(null);
        setMessage("Заявка отправлена получателю. Товар перейдёт к нему только после принятия.");
        attemptKey.current = null;
        setSource(null);
        return;
      }

      const localResult = body.result as {
        group: LocalBarcodeGroupDto;
        createdNewCode: boolean;
      };
      setCreated(localResult.createdNewCode ? localResult.group : null);
      setMessage(
        localResult.createdNewCode
          ? "Локальный штрихкод создан. Этикетка готова к печати."
          : "Группа передана. Локальный штрихкод сохранён.",
      );
      attemptKey.current = null;
      setSource(null);
      await load();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить передачу.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(group: LocalBarcodeGroupDto) {
    const reason = window
      .prompt("Укажите причину отмены локального штрихкода:")
      ?.trim();
    if (!reason) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/inventory/local-barcodes/${group.id}/cancel`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `local-cancel:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ version: group.version, reason }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setMessage(
        response.ok
          ? "Локальный штрихкод отменён; количество возвращено предыдущей группе."
          : localError(body.error),
      );
      if (response.ok) {
        await load();
        router.refresh();
      }
    } catch {
      setMessage("Не удалось отменить локальный штрихкод.");
    } finally {
      setBusy(false);
    }
  }

  if (!distribution) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        {message ? (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Загрузка распределения…
          </p>
        )}
      </section>
    );
  }

  const originalCanTransfer =
    !/^TMP-\d{4}-\d{6}$/i.test(distribution.originalBarcode) &&
    distribution.originalRemainder > 0 &&
    (distribution.originalResponsible?.id === actorId ||
      (actorRole === "admin" && !distribution.originalResponsible));

  return (
    <section
      className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"
      aria-labelledby="local-barcodes-title"
    >
      <div className="flex items-start gap-3">
        <Barcode className="mt-0.5 h-5 w-5 text-emerald-600" />
        <div>
          <h2 id="local-barcodes-title" className="font-semibold text-zinc-900">
            Локальные штрихкоды
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Исходное количество: {distribution.originalQuantity}. Остаток и
            активные локальные части всегда составляют это количество.
          </p>
        </div>
      </div>

      {message ? (
        <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {requestId ? (
        <p className="mt-3 text-sm">
          <a className="font-semibold text-emerald-800 underline" href={`/tmc/transfer-requests/${requestId}`}>
            Открыть заявку
          </a>
        </p>
      ) : null}

      {/^TMP-\d{4}-\d{6}$/i.test(distribution.originalBarcode) ? (
        <div role="alert" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="block">Штрихкод отсутствует</strong>
          Товар можно учитывать без штрихкода. Для распределения количества администратору нужно открыть редактирование карточки и указать исходный штрихкод 1С. После сохранения локальный код будет создан в формате «исходный код-0001».
        </div>
      ) : null}

      {created ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 p-3">
          <strong className="font-mono text-sm">{created.localBarcode}</strong>
          <a
            href={`/api/inventory/local-barcodes/${created.id}/label?download=1`}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
          >
            <Download className="h-4 w-4" /> Скачать
          </a>
          <a
            href={`/local-barcodes/${created.id}/label`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
          >
            <Printer className="h-4 w-4" /> Печать
          </a>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <article className="rounded-xl bg-zinc-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-semibold">
                {/^TMP-\d{4}-\d{6}$/i.test(distribution.originalBarcode)
                  ? "Штрихкод отсутствует"
                  : distribution.originalBarcode}
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Остаток: {distribution.originalRemainder} ·{" "}
                {distribution.originalResponsible?.fullName ??
                  "ответственный не назначен"}
              </p>
              <p className="text-xs text-zinc-500">
                {distribution.originalLocation.buildingName} ·{" "}
                {distribution.originalLocation.roomDesignation}
              </p>
            </div>
            {originalCanTransfer ? (
              <button
                type="button"
                onClick={() =>
                  openTransfer({
                    groupId: null,
                    label: distribution.originalBarcode,
                    available: distribution.originalRemainder,
                    version: distribution.originalVersion,
                    returnRecipient: null,
                  })
                }
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white"
              >
                <Send className="h-4 w-4" /> Передать часть
              </button>
            ) : null}
          </div>
        </article>

        {distribution.groups.map((group) => (
          <article
            key={group.id}
            className={`rounded-xl border p-4 ${
              group.status === "cancelled"
                ? "border-red-200 bg-red-50/50"
                : "border-zinc-200"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <a
                  href={`/local-barcodes/${group.id}`}
                  className="font-mono text-sm font-semibold text-emerald-800 hover:underline"
                >
                  {group.localBarcode}
                </a>
                <p className="mt-1 text-sm text-zinc-600">
                  Количество: {group.quantity} · {group.responsible.fullName}
                </p>
                <p className="text-xs text-zinc-500">
                  {group.location.buildingName} ·{" "}
                  {group.location.roomDesignation} ·{" "}
                  {new Date(group.transferredAt).toLocaleString()}
                </p>
                {group.status === "cancelled" ? (
                  <p className="mt-2 text-sm font-semibold text-red-700">
                    Отменён: {group.cancellation?.reason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.status === "active" && group.responsible.id === actorId && group.previousResponsible ? (
                  <button
                    type="button"
                    onClick={() =>
                      openTransfer({
                        groupId: group.id,
                        label: group.localBarcode,
                        available: group.quantity,
                        version: group.version,
                        returnRecipient: group.previousResponsible,
                      })
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Вернуть
                  </button>
                ) : null}
                {group.status === "active" && actorRole === "admin" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancel(group)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Отменить
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      {source ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="local-transfer-title"
        >
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <h3 id="local-transfer-title" className="text-lg font-semibold">
              Передача группы {source.label}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              Доступно: {source.available}
            </p>
            {source.returnRecipient ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                Вернуть можно только прежнему ответственному: {source.returnRecipient.fullName}
              </div>
            ) : (
              <TmcUserPicker
                value={recipient}
                employeeOnly
                onChange={(value) => {
                  setRecipient(value);
                  attemptKey.current = null;
                }}
              />
            )}
            <label className="mt-4 block text-sm font-semibold">
              Количество
              <input
                type="number"
                min={1}
                max={source.available}
                step={1}
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  attemptKey.current = null;
                }}
                className="mt-2 min-h-11 w-full rounded-xl border border-zinc-200 px-3"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSource(null)}
                className="rounded-xl border px-4 py-2.5"
              >
                Закрыть
              </button>
              <button
                type="button"
                disabled={busy || (!recipient && !source.returnRecipient)}
                onClick={() => void submit()}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Передача…" : "Подтвердить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function localError(code?: string) {
  const messages: Record<string, string> = {
    source_barcode_required:
      "Сначала укажите исходный штрихкод 1С в карточке товара. TMP-код не является штрихкодом 1С.",
    recipient_location_required:
      "В профиле получателя не назначена активная локация.",
    quantity_exceeds_available:
      "Количество превышает доступный остаток.",
    source_barcode_not_code39:
      "Исходный код содержит символы, которые нельзя напечатать в Code 39.",
    version_conflict:
      "Данные изменились. Обновите карточку и повторите.",
    local_group_has_active_children:
      "Сначала отмените отделённые от этой группы части.",
    cancellation_return_target_changed:
      "Предыдущая группа уже передана. Сначала восстановите её ответственного и локацию.",
    forbidden: "Недостаточно прав для этой операции.",
  };
  return messages[code ?? ""] ?? "Не удалось выполнить операцию.";
}
