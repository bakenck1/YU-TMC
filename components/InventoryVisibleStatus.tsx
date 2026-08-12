import type { VisibleItemStatus } from "@/lib/inventory-list";
import LegacyDisplayStatusBadge from "./LegacyDisplayStatusBadge";
import StatusBadge from "./StatusBadge";

export default function InventoryVisibleStatus({ status }: { status: VisibleItemStatus }) {
  return status.kind === "display" ? <LegacyDisplayStatusBadge value={status.value} /> : <StatusBadge status={status.value} />;
}
