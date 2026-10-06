import type { PassportRepositories, PassportRecord, PassportUpload } from "@/lib/application/ports/room-passport-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type { PassportMutation, RoomPassportDto } from "@/lib/contracts/room-passports";
import { MAX_PASSPORT_BYTES } from "@/lib/contracts/room-passports";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { passportActions, transitionPassport } from "@/lib/domain/room-passport";
import { hasPermission, type AuthorizationActor } from "@/lib/security/permissions";

export type PassportActor = AuthorizationActor & { sessionVersion: number };

export class RoomPassportService {
  constructor(
    private readonly unitOfWork: UnitOfWork<PassportRepositories>,
    private readonly ids: { create(): string },
    private readonly pdf: { validate(bytes: Uint8Array): Promise<void> },
  ) {}

  async list(actor: PassportActor) {
    assertManager(actor);
    return this.unitOfWork.read(async ({ passports }) => (await passports.list()).map(row => toDto(row, actor)));
  }

  async find(roomId: string, actor: PassportActor) {
    assertManager(actor);
    assertId(roomId);
    return this.unitOfWork.read(async ({ passports }) => {
      const record = await passports.find(roomId);
      if (!record) throw new ApplicationError("not_found", "room_not_found");
      return toDto(record, actor);
    });
  }

  async mutate(roomId: string, mutation: PassportMutation, actor: PassportActor, upload?: PassportUpload) {
    assertManager(actor);
    assertId(roomId);
    if (mutation.action === "upload") {
      if (!upload || upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_PASSPORT_BYTES) {
        throw new ApplicationError("validation", "passport_invalid_pdf");
      }
      if (!upload.name.trim() || upload.name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(upload.name)) {
        throw new ApplicationError("validation", "invalid_request");
      }
      // Check the version and action before spending time on PDF parsing.
      const current = await this.unitOfWork.read(({ passports }) => passports.find(roomId));
      if (!current) throw new ApplicationError("not_found", "room_not_found");
      transitionPassport(current, mutation, actor);
      await this.pdf.validate(upload.bytes);
    } else if (upload) throw new ApplicationError("validation", "invalid_request");
    return this.unitOfWork.transaction(async ({ passports }) => {
      const current = await passports.lock(roomId, actor);
      const next: PassportRecord = { ...current, ...transitionPassport(current, mutation, actor) };
      if (upload) {
        next.fileId = this.ids.create();
        next.fileName = upload.name.trim();
        next.fileSize = upload.bytes.byteLength;
        next.uploadedBy = actor.userId;
      }
      if (mutation.action === "delete") {
        next.fileName = null;
        next.fileSize = null;
      }
      await passports.save(next, upload);
      if (mutation.action === "submit" || mutation.action === "approve" || mutation.action === "reject") {
        await passports.notify(next, actor.userId, mutation.action === "submit" ? "submitted" : mutation.action === "approve" ? "approved" : "rejected");
      }
      return toDto(next, actor);
    });
  }

  async file(roomId: string, fileId: string, actor: PassportActor, published: boolean) {
    assertId(roomId);
    assertId(fileId);
    if (!published) assertManager(actor);
    const file = await this.unitOfWork.read(({ passports }) => passports.file(roomId, fileId, actor, published));
    if (!file) throw new ApplicationError("not_found", "passport_file_not_found");
    return file;
  }
}

export function toDto(row: PassportRecord, actor: AuthorizationActor): RoomPassportDto {
  return {
    roomId: row.roomId, buildingId: row.buildingId, buildingName: row.buildingName,
    floorNumber: row.floorNumber, floorLabel: row.floorLabel, designation: row.designation,
    status: row.status, version: row.version, uploadedBy: row.uploadedBy, submittedBy: row.submittedBy,
    rejectionReason: row.rejectionReason, rejectionComment: row.rejectionComment,
    file: row.fileId ? { id: row.fileId, name: row.fileName!, size: row.fileSize!, url: `/api/room-passports/${row.roomId}/file?fileId=${row.fileId}` } : null,
    actions: passportActions(row, actor),
  };
}
function assertId(id: string) {
  if (!isUuid(id)) throw new ApplicationError("validation", "invalid_id");
}
function assertManager(actor: PassportActor) {
  if (!hasPermission(actor.role, "inventory.passport.manage")) throw new ApplicationError("forbidden", "forbidden");
}
