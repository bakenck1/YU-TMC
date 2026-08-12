import { Check, X } from "lucide-react";

import Button from "@/components/Button";
import TextField from "@/components/TextField";
import Wrapper from "@/components/Wrapper";
import type { TransferDto } from "@/lib/contracts/inventory-responsibility";

type InventoryTransferListKind = "incoming" | "outgoing";

interface InventoryTransferListProps {
  kind: InventoryTransferListKind;
  transfers: TransferDto[];
  loading: boolean;
  busy: boolean;
  rejectComments?: Record<string, string>;
  onRejectCommentChange?: (transferId: string, value: string) => void;
  onConfirm?: (transfer: TransferDto) => void;
  onReject?: (transfer: TransferDto) => void;
  onCancel?: (transfer: TransferDto) => void;
}

const COPY: Record<InventoryTransferListKind, { title: string; empty: string }> = {
  incoming: { title: "Входящие запросы", empty: "Новых запросов нет." },
  outgoing: { title: "Мои запросы", empty: "Вы ещё не запрашивали передачу." },
};

const STATUS_LABELS: Record<TransferDto["status"], string> = {
  pending_current_owner: "Ожидает решения",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
  cancelled: "Отменено",
  overridden: "Изменено администратором",
};

export default function InventoryTransferList({
  kind,
  transfers,
  loading,
  busy,
  rejectComments = {},
  onRejectCommentChange,
  onConfirm,
  onReject,
  onCancel,
}: InventoryTransferListProps) {
  const copy = COPY[kind];

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">{copy.title}</h2>
      <Wrapper direction="column" gap="sm">
        {loading ? (
          <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">Загрузка…</p>
        ) : transfers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-white p-5 text-sm text-zinc-500">{copy.empty}</p>
        ) : (
          transfers.map((transfer) => (
            <article key={transfer.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <Wrapper direction="column" gap="md" responsive={{ at: "lg", direction: "row", align: "center", justify: "between" }}>
                <div>
                  <p className="font-semibold text-zinc-900">
                    {transfer.itemName ?? "ТМЦ"}{" "}
                    <span className="font-normal text-zinc-500">
                      ({transfer.itemInventoryNumber ?? transfer.itemId})
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Запросил: {transfer.requestedByName} · {new Date(transfer.requestedAt).toLocaleString("ru-RU")}
                  </p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {STATUS_LABELS[transfer.status]}
                  </p>
                  {transfer.decisionComment ? (
                    <p className="mt-2 text-sm text-red-700">Причина: {transfer.decisionComment}</p>
                  ) : null}
                </div>

                {transfer.status === "pending_current_owner" ? (
                  <Wrapper gap="sm" wrap align="center">
                    {kind === "incoming" ? (
                      <>
                        <Button variant="primary" size="sm" leadingIcon={Check} disabled={busy} onClick={() => onConfirm?.(transfer)}>
                          Подтвердить
                        </Button>
                        <Wrapper minWidthZero width="fit">
                          <TextField
                            label="Причина отклонения"
                            hideLabel
                            fieldSize="sm"
                            value={rejectComments[transfer.id] ?? ""}
                            onChange={(event) => onRejectCommentChange?.(transfer.id, event.target.value)}
                            placeholder="Причина отклонения"
                          />
                        </Wrapper>
                        <Button variant="danger-secondary" size="sm" leadingIcon={X} disabled={busy} onClick={() => onReject?.(transfer)}>
                          Отклонить
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => onCancel?.(transfer)}>
                        Отменить запрос
                      </Button>
                    )}
                  </Wrapper>
                ) : null}
              </Wrapper>
            </article>
          ))
        )}
      </Wrapper>
    </section>
  );
}
