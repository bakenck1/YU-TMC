"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, History, PackageCheck } from "lucide-react";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import PushNotificationControl from "@/components/PushNotificationControl";
import TmcOperationShell from "@/components/TmcOperationShell";
import type { UserRole } from "@/lib/contracts/users";
import {
  TMC_ENTRY_POINT,
  TMC_HISTORY,
  TMC_OPERATION_BY_ID,
} from "@/lib/tmc-navigation";
import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";
import type { InventoryItem } from "@/lib/types";

type WorkspaceTab = "receive" | "issue" | "transfer";

const ICONS = {
  receive: ArrowDownToLine,
  issue: ArrowUpFromLine,
  transfer: ArrowLeftRight,
} as const;

export default function TmcLanding({
  incomingRequests,
  issueItems,
  actorUserId,
  actorRole,
}: {
  incomingRequests: TmcTransferRequestCardView[];
  issueItems: InventoryItem[];
  actorUserId: string;
  actorRole: UserRole;
}) {
  const { t } = useAppSettings();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("receive");
  const tabs: WorkspaceTab[] = actorRole === "admin"
    ? ["receive", "issue", "transfer"]
    : ["receive", "issue"];

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 sm:text-2xl">{t(TMC_ENTRY_POINT.labelKey)}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("tmc.workspace.hint")}</p>
          </div>
          <Link href={TMC_HISTORY.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
            <History className="h-4 w-4" /> {t(TMC_HISTORY.labelKey)}
          </Link>
        </div>

        <div role="tablist" aria-label={t(TMC_ENTRY_POINT.labelKey)} className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1.5 sm:flex">
          {tabs.map((tab) => {
            const operation = TMC_OPERATION_BY_ID[tab];
            const Icon = ICONS[tab];
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-label={t(operation.labelKey)}
                aria-selected={selected}
                aria-controls={`tmc-workspace-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${selected ? "bg-white text-emerald-800 shadow-sm" : "text-zinc-600 hover:bg-white/70"}`}
              >
                <Icon className="h-4 w-4" /> {t(operation.labelKey)}
                {tab === "receive" && incomingRequests.length > 0 ? (
                  <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white">{incomingRequests.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      {activeTab === "receive" ? (
        <div id="tmc-workspace-receive" role="tabpanel" className="space-y-4">
          <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">{t("tmc.incoming.title")}</h3>
                <p className="mt-1 text-sm text-zinc-500">{t("tmc.incoming.hint")}</p>
              </div>
              <Link href={TMC_OPERATION_BY_ID.receive.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                <PackageCheck className="h-4 w-4" /> {t("tmc.incoming.acceptFree")}
              </Link>
            </div>
            {incomingRequests.length > 0 ? (
              <ul className="mt-5 space-y-3">
                {incomingRequests.map((request) => (
                  <li key={request.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-900">{request.initiator.fullName}</p>
                        <p className="mt-1 text-sm text-zinc-600">{t("tmc.incoming.pendingCount", { pending: request.summary.pending, total: request.summary.total })}</p>
                        {request.comment ? <p className="mt-2 line-clamp-2 text-sm text-zinc-500">{request.comment}</p> : null}
                      </div>
                      <Link href={`/tmc/transfer-requests/${request.id}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">
                        {t("tmc.incoming.openRequest")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-5 rounded-xl bg-zinc-50 p-5 text-sm text-zinc-500">{t("tmc.incoming.empty")}</p>}
          </section>
          <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"><PushNotificationControl hintKey="push.tmcHint" /></div>
        </div>
      ) : null}

      {activeTab === "issue" ? (
        <div id="tmc-workspace-issue" role="tabpanel">
          <TmcOperationShell
            operation={TMC_OPERATION_BY_ID.issue}
            issueItems={issueItems}
            actorUserId={actorUserId}
            actorRole={actorRole}
          />
        </div>
      ) : null}

      {activeTab === "transfer" && actorRole === "admin" ? (
        <section id="tmc-workspace-transfer" role="tabpanel" className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-900">{t("tmc.operation.transfer")}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{t("tmc.transfer.adminHint")}</p>
          <Link href="/items" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800">{t("tmc.transfer.openItems")}</Link>
        </section>
      ) : null}
    </section>
  );
}
