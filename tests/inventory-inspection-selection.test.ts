import assert from "node:assert/strict";
import test from "node:test";

import type { InspectionDto } from "../lib/contracts/inventory-inspections";
import { firstInspectionRoomId } from "../lib/inventory-inspection-selection";

test("selects the persisted inspection-room id, not the catalog room id", () => {
  const inspections: Pick<InspectionDto, "id" | "rooms">[] = [
    {
      id: "inspection-1",
      rooms: [
        {
          id: "inspection-room-1",
          buildingId: "building-1",
          roomId: "catalog-room-1",
          buildingName: "Main",
          buildingAddress: "Address",
          roomDesignation: "101",
          floorNumber: 1,
          floorLabel: null,
          addedAt: "2026-08-26T00:00:00.000Z",
          inspectedAt: null,
        },
      ],
    },
  ];
  assert.equal(
    firstInspectionRoomId(inspections, "inspection-1"),
    "inspection-room-1",
  );
});
