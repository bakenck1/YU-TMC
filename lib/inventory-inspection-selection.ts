import type { InspectionDto } from "@/lib/contracts/inventory-inspections";

export function firstInspectionRoomId(
  inspections: Pick<InspectionDto, "id" | "rooms">[],
  inspectionId: string | null,
) {
  return (
    inspections.find((inspection) => inspection.id === inspectionId)
      ?.rooms[0]?.roomId ?? ""
  );
}
