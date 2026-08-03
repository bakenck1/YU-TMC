import type { InspectionDto } from "@/lib/contracts/inventory-inspections";
import type { ItemResultDto } from "@/lib/contracts/inventory-inspection-results";

export function firstInspectionRoomId(
  inspections: Pick<InspectionDto, "id" | "rooms">[],
  inspectionId: string | null,
) {
  return (
    inspections.find((inspection) => inspection.id === inspectionId)
      ?.rooms[0]?.roomId ?? ""
  );
}

export function applyInspectionResult(
  inspections: InspectionDto[],
  result: ItemResultDto,
): InspectionDto[] {
  return inspections.map((inspection) => {
    if (inspection.id !== result.inspectionId) return inspection;
    const alreadyRecorded = inspection.results.some((entry) => entry.id === result.id);
    const results = alreadyRecorded
      ? inspection.results.map((entry) => (entry.id === result.id ? result : entry))
      : [...inspection.results, result];
    const expectedIds = new Set(inspection.items.map((item) => item.itemId));
    const expectedResults = results.filter((entry) => expectedIds.has(entry.itemId));
    const checked = new Set(expectedResults.map((entry) => entry.itemId)).size;
    const total = inspection.items.length;
    return {
      ...inspection,
      rooms: inspection.rooms.map((room) =>
        inspection.items.some((item) => item.inspectionRoomId === room.id) &&
        inspection.items
          .filter((item) => item.inspectionRoomId === room.id)
          .every((item) => results.some((entry) => entry.itemId === item.itemId))
          ? { ...room, inspectedAt: room.inspectedAt ?? result.createdAt }
          : room,
      ),
      results,
      progress: {
        checked,
        total,
        percent: total ? Math.round((checked / total) * 100) : 0,
        present: expectedResults.filter((entry) => entry.result === "present").length,
        missing: expectedResults.filter((entry) => entry.result === "missing").length,
        unchecked: Math.max(0, total - checked),
        comments: expectedResults.filter((entry) => entry.comment !== null).length,
      },
      displayStatus: total > 0 && checked === total ? "completed" : "in_progress",
    };
  });
}
