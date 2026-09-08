export type DockflowMarkingType =
  | "individual"
  | "batch"
  | "package_or_storage";

export interface DockflowEmployee {
  id: number;
  personnelId: number;
  iin: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  image: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  roles: string[];
  employedAt: string | null;
  orgUnit: { id: number; nameRu: string | null; nameKk: string | null; nameEn: string | null } | null;
  position: { id: number; name: string } | null;
  login: string;
  role: string;
}

export interface DockflowIssueHistoryEntry {
  issuedAt: string;
  quantity: number;
  employeeIin: string;
}

export interface DockflowEmployeeItem {
  id: string;
  name: string;
  barcode: string;
  inventoryNumber: string;
  quantity: number;
  status: "assigned";
  storageLocation: string;
  assignedAt: string;
  cost: number;
  markingType: DockflowMarkingType;
  photoUrl: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  inventoryStatus: string;
  responsible: { iin: string; fullName: string } | null;
  updatedAt: string;
  issueHistory: DockflowIssueHistoryEntry[];
}

export interface DockflowInventoryItem extends Omit<DockflowEmployeeItem, "status" | "assignedAt"> {
  availableQuantity: number;
  status: "assigned" | "in_stock";
  assignments: Array<{
    employeeIin: string;
    quantity: number;
    assignedAt: string;
  }>;
}

export interface DockflowItemPhoto {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export interface DockflowPageRequest {
  after: { sortValue: string; id: string } | null;
  limit: number;
}

export interface DockflowDataRepository {
  listEmployees(): Promise<Array<DockflowEmployee & { itemCount: number }>>;
  findEmployee(iin: string): Promise<DockflowEmployee | null>;
  itemsForEmployee(iin: string, page?: DockflowPageRequest): Promise<DockflowEmployeeItem[]>;
  listItems(page?: DockflowPageRequest): Promise<DockflowInventoryItem[]>;
  findItemPhoto(id: string): Promise<DockflowItemPhoto | null>;
}

export interface DockflowInventoryRepository {
  itemCountsByIin(): Promise<Map<string, number>>;
  itemsForEmployee(iin: string, page?: DockflowPageRequest): Promise<DockflowEmployeeItem[]>;
  listItems(page?: DockflowPageRequest): Promise<DockflowInventoryItem[]>;
  findItemPhoto(id: string): Promise<DockflowItemPhoto | null>;
}
