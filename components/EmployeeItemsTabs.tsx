"use client";

import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import ItemsTable from "@/components/ItemsTable";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";
import type { InventoryItem } from "@/lib/types";

const EMPLOYEE_TABS: ReadonlyArray<{ status: ItemStatus; label: string }> = [
  { status: "active", label: "status.active" },
  { status: "maintenance", label: "status.maintenance" },
  { status: "decommissioned", label: "status.decommissioned" },
];

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
      <div role="tablist" aria-label={t("nav.items")} className="flex flex-wrap gap-2 border-b border-black/10">
        {EMPLOYEE_TABS.map((tab) => {
          const selected = tab.status === activeStatus;
          return (
            <button
              key={tab.status}
              id={`employee-items-tab-${tab.status}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`employee-items-panel-${tab.status}`}
              onClick={() => setActiveStatus(tab.status)}
              className={`rounded-t-xl border-b-2 px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                selected
                  ? "border-emerald-500 text-emerald-700"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
              }`}
            >
              {t(tab.label as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>
      <div
        id={`employee-items-panel-${activeStatus}`}
        role="tabpanel"
        aria-labelledby={`employee-items-tab-${activeStatus}`}
      >
        <ItemsTable
          key={activeStatus}
          items={visibleItems}
          searchHistoryScope={searchHistoryScope}
          columnSettingsScope={columnSettingsScope}
        />
      </div>
    </section>
  );
}
