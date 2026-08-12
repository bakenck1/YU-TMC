import type { InspectionDto } from "@/lib/contracts/inventory-inspections";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type { TransferDto } from "@/lib/contracts/inventory-responsibility";

export const STORY_BUILDING: BuildingDto = {
  id: "building-main",
  name: "Главный корпус",
  address: "32 микрорайон",
  qrCode: "YUQ1:building-main",
  roomCount: 1,
  status: "active",
  version: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

export const STORY_ROOM: RoomDto = {
  id: "room-201",
  buildingId: STORY_BUILDING.id,
  designation: "201",
  floorNumber: 2,
  floorLabel: "2 этаж",
  primaryResponsible: { id: "user-1", name: "Demo User 1" },
  qrCode: "YUQ1:room-201",
  status: "active",
  version: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

export const STORY_ITEM_DTO: InventoryItemDto = {
  id: "item-1",
  name: "Моноблок HP",
  description: "Рабочее место",
  itemType: "Компьютер",
  brand: "HP",
  model: "ProOne 440",
  quantity: 1,
  unitPrice: 420000,
  inventoryNumberKind: "official",
  inventoryNumber: "YU-0001",
  room: {
    id: STORY_ROOM.id,
    designation: STORY_ROOM.designation,
    floorNumber: STORY_ROOM.floorNumber,
    buildingId: STORY_BUILDING.id,
    buildingName: STORY_BUILDING.name,
  },
  status: "active",
  condition: "good",
  connectionStatus: "connected",
  qrCode: "YUQ1:item-1",
  responsible: { id: "user-1", name: "Demo User 1" },
  photoUrl: null,
  version: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z",
  archivedAt: null,
};

export const STORY_INSPECTION: InspectionDto = {
  id: "inspection-1",
  name: "Проверка августа",
  technicianId: "user-1",
  status: "draft",
  version: 1,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z",
  deadlineAt: "2026-08-31T18:00:00.000Z",
  rooms: [],
  items: [],
  results: [],
  progress: { checked: 4, total: 10, percent: 40, present: 3, missing: 1, unchecked: 6, comments: 1 },
  displayStatus: "in_progress",
};

export const STORY_TRANSFER: TransferDto = {
  id: "transfer-1",
  itemId: STORY_ITEM_DTO.id,
  itemName: STORY_ITEM_DTO.name,
  itemInventoryNumber: STORY_ITEM_DTO.inventoryNumber,
  requestedByName: "Demo User 2",
  status: "pending_current_owner",
  requestedAt: "2026-08-12T09:00:00.000Z",
  closedAt: null,
  decisionComment: null,
  version: 1,
  direction: "incoming",
};
