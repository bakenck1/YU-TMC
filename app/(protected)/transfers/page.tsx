import InventoryTransfersManager from "@/components/InventoryTransfersManager";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function TransfersPage() {
  await requireAuthorizedPage("/transfers");
  return <InventoryTransfersManager />;
}
