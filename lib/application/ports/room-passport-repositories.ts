import type { RoomPassportDto } from "@/lib/contracts/room-passports";
import type { PassportState } from "@/lib/domain/room-passport";
import type { AuthorizationActor } from "@/lib/security/permissions";

export interface PassportRecord extends PassportState {
  roomId: string;
  buildingId: string;
  buildingName: string;
  floorNumber: number;
  floorLabel: string | null;
  designation: string;
  fileName: string | null;
  fileSize: number | null;
}
export interface PassportUpload { bytes: Uint8Array; name: string; }
export interface PassportRepository {
  list(): Promise<PassportRecord[]>;
  find(roomId: string): Promise<PassportRecord | null>;
  lock(roomId: string, actor: AuthorizationActor & { sessionVersion: number }): Promise<PassportRecord>;
  save(record: PassportRecord, upload?: PassportUpload): Promise<void>;
  file(roomId: string, fileId: string, actor: AuthorizationActor & { sessionVersion: number }, published: boolean): Promise<{ bytes: Uint8Array; name: string } | null>;
  notify(record: PassportRecord, actorId: string, event: "submitted" | "approved" | "rejected"): Promise<void>;
}
export interface PassportRepositories { passports: PassportRepository; }
export type PassportList = RoomPassportDto[];
