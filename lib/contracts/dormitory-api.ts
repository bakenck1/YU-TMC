export type DormitoryAssetStatus = "active" | "maintenance" | "written_off";

export type DormitoryAssetCondition = "good" | "needs_attention" | "damaged";

export interface DormitoryAsset {
  id: string;
  code: string;
  inventoryNumber: string;
  name: string;
  category: string;
  acceptanceDate: string | null;
  responsiblePerson: string | null;
  department: string | null;
  location: {
    buildingId: string;
    buildingName: string;
    roomId: string;
    room: string;
    floorNumber: number;
  };
  initialCost: number;
  residualCost: number | null;
  currency: "KZT";
  status: DormitoryAssetStatus;
  condition: DormitoryAssetCondition;
  accountingStatus: string | null;
  updatedAt: string;
}

export interface DormitoryAssetPageRequest {
  after: { updatedAt: string; id: string } | null;
  limit: number;
}

export interface DormitoryAssetRepository {
  listItems(page: DormitoryAssetPageRequest): Promise<DormitoryAsset[]>;
}
