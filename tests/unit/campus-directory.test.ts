import { describe, expect, it } from "vitest";

import {
  CAMPUS_ADDRESS,
  CAMPUS_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "@/lib/campus-directory";

describe("campus building directory", () => {
  it("contains the seven approved 32nd microdistrict buildings", () => {
    expect(CAMPUS_BUILDING_PRESETS).toHaveLength(7);
    expect(CAMPUS_BUILDING_PRESETS.map((preset) => preset.address)).toEqual(
      Array(7).fill(CAMPUS_ADDRESS),
    );
    expect(findCampusBuildingPreset("The Main Campus")?.floorCount).toBe(15);
    expect(findCampusBuildingPreset("Общежитие-2")?.floorCount).toBe(5);
  });
});
