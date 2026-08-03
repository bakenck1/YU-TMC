"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import ItemsTable from "@/components/ItemsTable";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";
import {
  EMPLOYEE_ITEM_STATUSES,
  employeeItemTabAfterKey,
} from "@/lib/employee-items-tabs";
import type { InventoryItem } from "@/lib/types";

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
}: {
  activeStatus: ItemStatus;
  ariaLabel: string;
  label: (status: ItemStatus) => string;
  onSelect: (status: ItemStatus) => void;
}) {
  const tabRefs = useRef(new Map<ItemStatus, HTMLButtonElement>());

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextStatus = employeeItemTabAfterKey(activeStatus, event.key);
    if (!nextStatus) return;

    event.preventDefault();
    onSelect(nextStatus);
    tabRefs.current.get(nextStatus)?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-2 border-b border-black/10">
      {EMPLOYEE_ITEM_STATUSES.map((status) => {
        const selected = status === activeStatus;
        return (
          <button
            key={status}
            ref={(element) => {
              if (element) tabRefs.current.set(status, element);
              else tabRefs.current.delete(status);
            }}
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
  renderActive,
}: {
  activeStatus: ItemStatus;
  renderActive: () => ReactNode;
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
        {selected ? renderActive() : null}
      </div>
    );
  });
}

export default function EmployeeItemsTabs({
  items,
  searchHistoryScope,
  columnSettingsScope,
}: {
  items: InventoryItem[];
  searchHistoryScope: string;
  columnSettingsScope: string;
}) {
  const { t } = useAppSettings();
  const [activeStatus, setActiveStatus] = useState<ItemStatus>("active");
  const visibleItems = items.filter((item) => item.status === activeStatus);

  return (
    <section aria-label={t("nav.items")} className="space-y-4">
      <EmployeeItemsTabList
        activeStatus={activeStatus}
        ariaLabel={t("nav.items")}
        label={(status) => t(EMPLOYEE_TAB_LABELS[status])}
        onSelect={setActiveStatus}
      />
      <EmployeeItemsTabPanels
        activeStatus={activeStatus}
        renderActive={() => (
          <ItemsTable
            key={activeStatus}
            items={visibleItems}
            searchHistoryScope={searchHistoryScope}
            columnSettingsScope={columnSettingsScope}
          />
        )}
      />
    </section>
  );
}
