import type { Building } from "@/lib/types";
import LocationBuildingCard from "./LocationBuildingCard";

export default function LocationsTree({ buildings }: { buildings: Building[] }) {
  return <div className="space-y-3">{buildings.map((building) => <LocationBuildingCard key={building.id} building={building} />)}</div>;
}
