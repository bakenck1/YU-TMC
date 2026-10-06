export const PASSPORT_STATUSES = ["not_started", "in_progress", "in_review", "needs_correction", "approved"] as const;
export type PassportStatus = (typeof PASSPORT_STATUSES)[number];
export const PASSPORT_REJECTION_REASONS = ["wrong_room", "incomplete", "incorrect", "unreadable", "unsigned", "other"] as const;
export type PassportRejectionReason = (typeof PASSPORT_REJECTION_REASONS)[number];
export const PASSPORT_ACTIONS = ["start", "upload", "submit", "return", "approve", "reject", "delete"] as const;
export type PassportAction = (typeof PASSPORT_ACTIONS)[number];
export const MAX_PASSPORT_BYTES = 20 * 1024 * 1024;

export interface PassportFileDto {
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface RoomPassportDto {
  roomId: string;
  buildingId: string;
  buildingName: string;
  floorNumber: number;
  floorLabel: string | null;
  designation: string;
  status: PassportStatus;
  version: number;
  file: PassportFileDto | null;
  uploadedBy: string | null;
  submittedBy: string | null;
  rejectionReason: PassportRejectionReason | null;
  rejectionComment: string | null;
  actions: PassportAction[];
}

export interface PassportMutation {
  action: PassportAction;
  version: number;
  reason?: PassportRejectionReason;
  comment?: string;
}
