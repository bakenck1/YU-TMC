export const CAMPUS_ADDRESS = "32-й микрорайон, Актау";

export interface CampusBuildingPreset {
  id: string;
  name: string;
  legacyNames?: readonly string[];
  mapVisible?: boolean;
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
  {
    id: "off-campus-dormitory-1",
    name: "Общежитие 1",
    mapVisible: false,
    address: "Микрорайон 3Б, 10, Актау",
    floorCount: 5,
  },
  {
    id: "off-campus-dormitory-2",
    name: "Общежитие 2",
    mapVisible: false,
    address: "27 микрорайон, 7, Актау",
    floorCount: 5,
  },
] as const;

export const CAMPUS_MAP_BUILDING_PRESETS = CAMPUS_BUILDING_PRESETS.filter(
  (preset) => preset.mapVisible !== false,
);

export function findCampusBuildingPreset(
  name: string,
): CampusBuildingPreset | undefined {
  return CAMPUS_BUILDING_PRESETS.find(
    (preset) =>
      preset.name === name || preset.legacyNames?.includes(name) === true,
  );
}
