import type { RoomPassportDto } from "@/lib/contracts/room-passports";
export const PASSPORT_FIXTURE: RoomPassportDto = {
  roomId: "11111111-1111-4111-8111-111111111111", buildingId: "22222222-2222-4222-8222-222222222222",
  buildingName: "Главный корпус", floorNumber: 2, floorLabel: null, designation: "201 К",
  status: "not_started", version: 0, file: null, uploadedBy: null, submittedBy: null,
  rejectionReason: null, rejectionComment: null, actions: ["start"],
};
export const PASSPORT_FILE_FIXTURE = { id: "33333333-3333-4333-8333-333333333333", name: "Паспорт кабинета 201 К.pdf", size: 1048576, url: "/api/room-passports/11111111-1111-4111-8111-111111111111/file?fileId=33333333-3333-4333-8333-333333333333" };
export const PASSPORT_LIST_FIXTURE: RoomPassportDto[] = [
  PASSPORT_FIXTURE,
  { ...PASSPORT_FIXTURE, roomId: "room2", designation: "202 К", status: "in_progress", actions: ["upload"] },
  { ...PASSPORT_FIXTURE, roomId: "room3", floorNumber: 3, designation: "301 К", status: "in_review", file: PASSPORT_FILE_FIXTURE, actions: ["return", "approve", "reject"] },
  { ...PASSPORT_FIXTURE, roomId: "room4", floorNumber: 3, designation: "302 К", status: "needs_correction", file: PASSPORT_FILE_FIXTURE, rejectionReason: "incomplete", rejectionComment: "Дополните сведения об оборудовании кабинета.", actions: ["upload"] },
  { ...PASSPORT_FIXTURE, roomId: "room5", designation: "101", buildingId: "other-building", buildingName: "Технопарк", floorNumber: 1, status: "approved", file: PASSPORT_FILE_FIXTURE, actions: ["return", "delete"] },
];
