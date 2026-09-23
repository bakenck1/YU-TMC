export interface FacilitiesBuilding {
  id: string;
  name: string;
  address: string;
  roomCount: number;
  updatedAt: string;
}

export interface FacilitiesRoom {
  id: string;
  buildingId: string;
  buildingName: string;
  designation: string;
  floorNumber: number;
  floorLabel: string | null;
  updatedAt: string;
}

export interface FacilitiesRepository {
  listBuildings(): Promise<FacilitiesBuilding[]>;
  listRooms(buildingId?: string): Promise<FacilitiesRoom[]>;
}
