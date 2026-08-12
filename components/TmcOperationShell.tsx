"use client";

import TmcItemQrFlow from "@/components/TmcItemQrFlow";
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
  return (
    <TmcItemQrFlow
      operation={operation}
      issueItems={issueItems}
      actorUserId={actorUserId}
      actorRole={actorRole}
    />
  );
}
