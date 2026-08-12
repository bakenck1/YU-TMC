"use client";

import {
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import ItemsTable from "@/components/ItemsTable";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";
import {
  EMPLOYEE_ITEM_STATUSES,
  employeeItemTabAfterKey,
  employeeItemsForStatus,
} from "@/lib/employee-items-tabs";
import type { InventoryItem } from "@/lib/types";
import type { UserRole } from "@/lib/contracts/users";

const EMPLOYEE_TAB_LABELS = {
  active: "status.active",
  maintenance: "status.maintenance",
  decommissioned: "status.decommissioned",
} as const;

export function EmployeeItemsTabList({
  activeStatus,
  ariaLabel,
  label,
  onSelect,
  focusTab = (status) =>
    document.getElementById(`employee-items-tab-${status}`)?.focus(),
}: {
  activeStatus: ItemStatus;
  ariaLabel: string;
  label: (status: ItemStatus) => string;
  onSelect: (status: ItemStatus) => void;
  focusTab?: (status: ItemStatus) => void;
}) {
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextStatus = employeeItemTabAfterKey(activeStatus, event.key);
    if (!nextStatus) return;

    event.preventDefault();
    onSelect(nextStatus);
    focusTab(nextStatus);
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-2 border-b border-black/10">
      {EMPLOYEE_ITEM_STATUSES.map((status) => {
        const selected = status === activeStatus;
        return (
          <button
            key={status}
            id={`employee-items-tab-${status}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`employee-items-panel-${status}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(status)}
            onKeyDown={handleTabKeyDown}
            className={`rounded-t-xl border-b-2 px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
              selected
                ? "border-emerald-500 text-emerald-700"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
            }`}
          >
            {label(status)}
          </button>
        );
      })}
    </div>
  );
}

export function EmployeeItemsTabPanels({
  activeStatus,
  items,
  searchHistoryScope,
  columnSettingsScope,
  actorUserId,
  actorRole,
}: {
  activeStatus: ItemStatus;
  items: InventoryItem[];
  searchHistoryScope: string;
  columnSettingsScope: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  return EMPLOYEE_ITEM_STATUSES.map((status) => {
    const selected = status === activeStatus;
    return (
      <div
        key={status}
        id={`employee-items-panel-${status}`}
        role="tabpanel"
        aria-labelledby={`employee-items-tab-${status}`}
        hidden={!selected}
        tabIndex={0}
      >
        {selected ? (
          <ItemsTable
            key={status}
            items={employeeItemsForStatus(items, status)}
            searchHistoryScope={searchHistoryScope}
            columnSettingsScope={columnSettingsScope}
            bulkActions={{ actorUserId, actorRole, buildings: [], rooms: [] }}
          />
        ) : null}
      </div>
    );
  });
}

export function EmployeeItemsTabsView({
  items,
  activeStatus,
  ariaLabel,
  label,
  onSelect,
  focusTab,
  searchHistoryScope,
  columnSettingsScope,
  actorUserId,
  actorRole,
}: {
  items: InventoryItem[];
  activeStatus: ItemStatus;
  ariaLabel: string;
  label: (status: ItemStatus) => string;
  onSelect: (status: ItemStatus) => void;
  focusTab?: (status: ItemStatus) => void;
  searchHistoryScope: string;
  columnSettingsScope: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  return (
    <>
      <EmployeeItemsTabList
        activeStatus={activeStatus}
        ariaLabel={ariaLabel}
        label={label}
        onSelect={onSelect}
        focusTab={focusTab}
      />
      <EmployeeItemsTabPanels
        activeStatus={activeStatus}
        items={items}
        searchHistoryScope={searchHistoryScope}
        columnSettingsScope={columnSettingsScope}
        actorUserId={actorUserId}
        actorRole={actorRole}
      />
    </>
  );
}

export default function EmployeeItemsTabs({
  items,
  searchHistoryScope,
  columnSettingsScope,
  actorUserId,
  actorRole,
}: {
  items: InventoryItem[];
  searchHistoryScope: string;
  columnSettingsScope: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const { t } = useAppSettings();
  const [activeStatus, setActiveStatus] = useState<ItemStatus>("active");

  return (
    <section aria-label={t("nav.items")} className="space-y-4">
      <div className="flex justify-end">
        <Link href="/transfers" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
          <ArrowRightLeft className="h-4 w-4" /> Передачи ТМЦ
        </Link>
      </div>
      <EmployeeItemsTabsView
        items={items}
        activeStatus={activeStatus}
        ariaLabel={t("nav.items")}
        label={(status) => t(EMPLOYEE_TAB_LABELS[status])}
        onSelect={setActiveStatus}
        searchHistoryScope={searchHistoryScope}
        columnSettingsScope={columnSettingsScope}
        actorUserId={actorUserId}
        actorRole={actorRole}
      />
    </section>
  );
}
