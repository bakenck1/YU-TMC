import LocationsTree from "@/components/LocationsTree";
import { buildings } from "@/lib/data";

export default function LocationsPage() {
  return <LocationsTree buildings={buildings} />;
}
