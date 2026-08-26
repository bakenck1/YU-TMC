"use client";

import { Check, X } from "lucide-react";

import Button from "@/components/Button";
import TextField from "@/components/TextField";
import Wrapper from "@/components/Wrapper";
import type { TransferDto } from "@/lib/contracts/inventory-responsibility";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

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

const COPY: Record<InventoryTransferListKind, { title: TranslationKey; empty: TranslationKey }> = {
  incoming: { title: "transfers.incomingTitle", empty: "transfers.incomingEmpty" },
  outgoing: { title: "transfers.outgoingTitle", empty: "transfers.outgoingEmpty" },
};

const STATUS_LABELS: Record<TransferDto["status"], TranslationKey> = {
  pending_current_owner: "transfers.status.pending",
  confirmed: "transfers.status.confirmed",
  rejected: "transfers.status.rejected",
  cancelled: "transfers.status.cancelled",
  overridden: "transfers.status.overridden",
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
  const { locale, t } = useAppSettings();

  return (
    <section aria-labelledby={`transfers-${kind}-title`}>
      <h2 id={`transfers-${kind}-title`} className="mb-3 text-lg font-semibold text-zinc-900">{t(copy.title)}</h2>
      <Wrapper direction="column" gap="sm">
        {loading ? (
          <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">{t("transfers.loading")}</p>
        ) : transfers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 bg-white p-5 text-sm text-zinc-500">{t(copy.empty)}</p>
        ) : (
          transfers.map((transfer) => (
            <article key={transfer.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <Wrapper direction="column" gap="md" responsive={{ at: "lg", direction: "row", align: "center", justify: "between" }}>
                <div>
                  <p className="font-semibold text-zinc-900">
                    {transfer.itemName ?? t("transfers.itemFallback")}{" "}
                    <span className="font-normal text-zinc-500">
                      ({transfer.itemInventoryNumber ?? transfer.itemId})
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {t("transfers.requestedBy", {
                      name: transfer.requestedByName,
                      date: new Date(transfer.requestedAt).toLocaleString(locale),
                    })}
                  </p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {t(STATUS_LABELS[transfer.status])}
                  </p>
                  {transfer.decisionComment ? (
                    <p className="mt-2 text-sm text-red-700">
                      {t("transfers.reason", { reason: transfer.decisionComment })}
                    </p>
                  ) : null}
                </div>

                {transfer.status === "pending_current_owner" ? (
                  <Wrapper gap="sm" wrap align="center">
                    {kind === "incoming" ? (
                      <>
                        <Button variant="primary" size="sm" leadingIcon={Check} disabled={busy} onClick={() => onConfirm?.(transfer)}>
                          {t("transfers.confirm")}
                        </Button>
                        <Wrapper minWidthZero width="fit">
                          <TextField
                            label={t("transfers.rejectReason")}
                            hideLabel
                            fieldSize="sm"
                            value={rejectComments[transfer.id] ?? ""}
                            onChange={(event) => onRejectCommentChange?.(transfer.id, event.target.value)}
                            placeholder={t("transfers.rejectReason")}
                          />
                        </Wrapper>
                        <Button variant="danger-secondary" size="sm" leadingIcon={X} disabled={busy} onClick={() => onReject?.(transfer)}>
                          {t("transfers.reject")}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => onCancel?.(transfer)}>
                        {t("transfers.cancelRequest")}
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
