"use client";

import TmcItemQrFlow from "@/components/TmcItemQrFlow";
import ItemsTable from "@/components/ItemsTable";
import type { InventoryItem } from "@/lib/types";
import type { UserRole } from "@/lib/contracts/users";
import type { TmcOperationNavigation } from "@/lib/tmc-navigation";

export default function TmcOperationShell({
  operation,
  issueItems = [],
  actorUserId,
  actorRole,
}: {
  operation: TmcOperationNavigation;
  issueItems?: InventoryItem[];
  actorUserId?: string;
  actorRole?: UserRole;
}) {
  const fallback = operation.id === "issue" && actorUserId && actorRole ? (
    <div className="mt-6 border-t border-zinc-100 pt-6">
      <ItemsTable
        items={issueItems}
        searchHistoryScope={`tmc-issue:${actorUserId}`}
        columnSettingsScope={`tmc-issue:${actorUserId}`}
        bulkActions={{
          actorUserId,
          actorRole,
          buildings: [],
          rooms: [],
          variant: "issue",
        }}
      />
    </div>
  ) : null;
  return <TmcItemQrFlow operation={operation} fallback={fallback} />;
}
