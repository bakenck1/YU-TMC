export type DormitoryRequestedAction = "repair" | "damaged" | "missing" | "other";

export interface CreateDormitoryRequestInput {
  externalRequestId: string;
  itemId: string;
  action: DormitoryRequestedAction;
  description: string;
  reporterName: string;
}

export interface DormitoryRequestResult {
  id: string;
  externalRequestId: string;
  item: { id: string; name: string; inventoryNumber: string };
  action: DormitoryRequestedAction;
  status: "new";
  createdAt: string;
  replayed: boolean;
}

export interface DormitoryRequestRepository {
  create(input: CreateDormitoryRequestInput, requestHash: string): Promise<DormitoryRequestResult>;
}
