"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import PushNotificationControl from "@/components/PushNotificationControl";
import {
  TMC_ENTRY_POINT,
  TMC_OPERATIONS,
  type TmcOperationNavigation,
} from "@/lib/tmc-navigation";

const OPERATION_ICONS = {
  receive: ArrowDownToLine,
  issue: ArrowUpFromLine,
  transfer: ArrowLeftRight,
} satisfies Record<TmcOperationNavigation["id"], typeof ArrowLeftRight>;

export default function TmcLanding() {
  const { t } = useAppSettings();

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
        {t(TMC_ENTRY_POINT.labelKey)}
      </h2>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TMC_OPERATIONS.map((operation) => {
          const Icon = OPERATION_ICONS[operation.id];
          return (
            <Link
              key={operation.id}
              href={operation.href}
              className="group flex min-h-28 items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-zinc-900 transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:flex-col sm:items-start sm:justify-between"
            >
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition group-hover:scale-105"
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 break-words text-base font-semibold leading-snug">
                {t(operation.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="mt-5 border-t border-zinc-100 pt-5">
        <PushNotificationControl hintKey="push.tmcHint" />
      </div>
    </section>
  );
}
