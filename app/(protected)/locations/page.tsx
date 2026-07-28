// Authentication for this route group is enforced by the adjacent layout.
import LocationsTree from "@/components/LocationsTree";
import { buildings } from "@/lib/data";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";

export default async function LocationsPage() {
  await requireAuthorizedPage("/locations");
  return <LocationsTree buildings={buildings} />;
}
