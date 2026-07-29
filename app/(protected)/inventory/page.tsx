// Authentication for this route group is enforced by the adjacent layout.
import InventoryBuildingsManager from "@/components/InventoryBuildingsManager";
import { getApplicationServices } from "@/lib/server/application";
import { authorizationActor } from "@/lib/server/security/request-user";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const currentUser = await requireAuthorizedPage("/inventory");
  const buildings =
    await getApplicationServices().locations.listBuildings(
      authorizationActor(currentUser),
    );
  return (
    <InventoryBuildingsManager
      actorRole={currentUser.role}
      initialBuildings={buildings}
    />
  );
}
