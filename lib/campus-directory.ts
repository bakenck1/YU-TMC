export const CAMPUS_ADDRESS = "32-й микрорайон, Актау";

export interface CampusBuildingPreset {
  id: string;
  name: string;
  legacyNames?: readonly string[];
  address: string;
  floorCount: number;
}

export const CAMPUS_BUILDING_PRESETS: readonly CampusBuildingPreset[] = [
  {
    id: "main-campus",
    name: "The Main Campus",
    address: CAMPUS_ADDRESS,
    floorCount: 15,
  },
  {
    id: "kgise",
    name: "Kazakh-German Institute of Sustainable Engineering",
    address: CAMPUS_ADDRESS,
    floorCount: 4,
  },
  {
    id: "yessenov-technopark",
    name: "Yessenov Technopark",
    address: CAMPUS_ADDRESS,
    floorCount: 2,
  },
  {
    id: "marine-academy",
    name: "Корпус Морской академии",
    address: CAMPUS_ADDRESS,
    floorCount: 3,
  },
  {
    id: "sports-complex",
    name: "Спортивный комплекс",
    address: CAMPUS_ADDRESS,
    floorCount: 2,
  },
  {
    id: "dormitory-1",
    name: "Общежитие 3",
    legacyNames: ["Общежитие-1"],
    address: CAMPUS_ADDRESS,
    floorCount: 5,
  },
  {
    id: "dormitory-2",
    name: "Общежитие 4",
    legacyNames: ["Общежитие-2"],
    address: CAMPUS_ADDRESS,
    floorCount: 5,
  },
] as const;

export function findCampusBuildingPreset(
  name: string,
): CampusBuildingPreset | undefined {
  return CAMPUS_BUILDING_PRESETS.find(
    (preset) =>
      preset.name === name || preset.legacyNames?.includes(name) === true,
  );
}
