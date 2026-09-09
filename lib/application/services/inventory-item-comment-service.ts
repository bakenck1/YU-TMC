import type { InventoryItemCommentDto } from "@/lib/contracts/inventory-items";
import type {
  InventoryItemCommentRecord,
  InventoryItemRecord,
  InventoryItemRepository,
  StoredInventoryItemCommentAttachment,
} from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

export interface InventoryItemCommentAttachmentInput {
  fileName: unknown;
  mediaType: unknown;
  binaryData: Uint8Array;
}

type InventoryItemCommentRepository = Pick<
  InventoryItemRepository,
  | "appendAudit"
  | "findCommentAttachment"
  | "findItemById"
  | "insertCommentAttachment"
  | "listComments"
>;

export interface InventoryItemCommentRepositories {
  items: InventoryItemCommentRepository;
}

interface Clock {
  now(): Date;
}

interface IdSource {
  create(): string;
}

export class InventoryItemCommentService {
  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryItemCommentRepositories>,
    private readonly clock: Clock,
    private readonly ids: IdSource,
  ) {}

  async listComments(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemCommentDto[]> {
    requirePermission(actor, "inventory.item.comment.read");
    const normalizedId = normalizeItemId(id);
    const records = await this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw itemNotFound();
      assertItemReadable(item, actor);
      return items.listComments(normalizedId);
    });
    return records.map((record) =>
      toCommentDto(normalizedId, record, actor.role === "admin"),
    );
  }

  async addComment(
    id: string,
    message: unknown,
    actor: AuthorizationActor,
    attachment?: InventoryItemCommentAttachmentInput,
  ): Promise<InventoryItemCommentDto[]> {
    requirePermission(actor, "inventory.item.comment");
    const normalizedId = normalizeItemId(id);
    const normalizedMessage = normalizeText(message, 2_000, "invalid_comment");
    const normalizedAttachment = attachment
      ? normalizeCommentAttachment(attachment)
      : null;
    const occurredAt = this.clock.now();
    const commentId = this.ids.create();
    const records = await this.unitOfWork.transaction(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw itemNotFound();
      assertItemReadable(item, actor);
      await items.appendAudit({
        id: commentId,
        actorId: actor.userId,
        actorRole: actor.role,
        subjectId: normalizedId,
        subjectRevision: item.version,
        action: "item.comment_added",
        beforeValues: null,
        afterValues: { message: normalizedMessage },
        occurredAt,
      });
      if (normalizedAttachment) {
        await items.insertCommentAttachment({
          id: this.ids.create(),
          commentId,
          ...normalizedAttachment,
          createdAt: occurredAt,
        });
      }
      return items.listComments(normalizedId);
    });
    return records.map((record) =>
      toCommentDto(normalizedId, record, actor.role === "admin"),
    );
  }

  async findCommentAttachment(
    itemId: string,
    commentId: string,
    attachmentId: string,
    actor: AuthorizationActor,
  ): Promise<StoredInventoryItemCommentAttachment> {
    requirePermission(actor, "inventory.item.comment.read");
    const normalizedItemId = normalizeItemId(itemId);
    const normalizedCommentId = normalizeUuid(commentId, "invalid_comment_id");
    const normalizedAttachmentId = normalizeUuid(attachmentId, "invalid_attachment_id");
    return this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedItemId);
      if (!item) throw itemNotFound();
      assertItemReadable(item, actor);
      const attachment = await items.findCommentAttachment(
        normalizedItemId,
        normalizedCommentId,
        normalizedAttachmentId,
      );
      if (!attachment) {
        throw new ApplicationError("not_found", "attachment_not_found");
      }
      return attachment;
    });
  }
}

function assertItemReadable(item: InventoryItemRecord, actor: AuthorizationActor) {
  if (
    !hasPermission(actor.role, "inventory.item.read_all") &&
    !(
      hasPermission(actor.role, "inventory.item.read_assigned") &&
      (item.responsibleId === actor.userId ||
        item.roomResponsibleId === actor.userId)
    )
  ) {
    throw itemNotFound();
  }
}

function requirePermission(
  actor: AuthorizationActor,
  permission: Parameters<typeof hasPermission>[1],
) {
  if (!hasPermission(actor.role, permission)) {
    throw new ApplicationError("forbidden", "forbidden");
  }
}

function itemNotFound() {
  return new ApplicationError("not_found", "item_not_found");
}

function normalizeText(value: unknown, max: number, code: string) {
  if (typeof value !== "string") throw new ApplicationError("validation", code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > max) {
    throw new ApplicationError("validation", code);
  }
  return normalized;
}

function normalizeUuid(value: unknown, code: string) {
  const normalized = normalizeText(value, 64, code);
  if (!isUuid(normalized)) throw new ApplicationError("validation", code);
  return normalized;
}

function normalizeItemId(value: unknown) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new ApplicationError("validation", "invalid_id");
  }
  return normalized;
}

const COMMENT_ATTACHMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

function normalizeCommentAttachment(input: InventoryItemCommentAttachmentInput) {
  const rawName = normalizeText(input.fileName, 255, "invalid_comment_attachment");
  const fileName = rawName
    .replace(/.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const mediaType = normalizeText(input.mediaType, 127, "invalid_comment_attachment")
    .toLocaleLowerCase("en-US");
  if (
    !fileName ||
    [...fileName].length > 180 ||
    !COMMENT_ATTACHMENT_MEDIA_TYPES.has(mediaType) ||
    !(input.binaryData instanceof Uint8Array) ||
    input.binaryData.byteLength < 1 ||
    input.binaryData.byteLength > 2 * 1024 * 1024
  ) {
    throw new ApplicationError("validation", "invalid_comment_attachment");
  }
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (!attachmentContentMatches(mediaType, extension, input.binaryData)) {
    throw new ApplicationError("validation", "invalid_comment_attachment");
  }
  return {
    fileName,
    mediaType,
    sizeBytes: input.binaryData.byteLength,
    binaryData: input.binaryData,
  };
}

function attachmentContentMatches(
  mediaType: string,
  extension: string,
  bytes: Uint8Array,
) {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const asciiPrefix = (length: number) =>
    new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(length, bytes.length)));
  switch (mediaType) {
    case "application/pdf": {
      if (extension !== "pdf" || asciiPrefix(5) !== "%PDF-") return false;
      const content = asciiPrefix(bytes.length).toLowerCase();
      return !["/javascript", "/js", "/launch", "/embeddedfile"].some((marker) =>
        content.includes(marker),
      );
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      const expectedExtension = mediaType.includes("wordprocessingml") ? "docx" : "xlsx";
      if (extension !== expectedExtension || !startsWith(0x50, 0x4b)) return false;
      const directoryText = asciiPrefix(bytes.length).toLowerCase();
      const expectedRoot = expectedExtension === "docx" ? "word/" : "xl/";
      return (
        directoryText.includes("[content_types].xml") &&
        directoryText.includes(expectedRoot) &&
        !["vbaproject.bin", "oleobject", "embeddings/", "externallink"].some((marker) =>
          directoryText.includes(marker),
        )
      );
    }
    case "image/jpeg":
      return ["jpg", "jpeg"].includes(extension) && startsWith(0xff, 0xd8, 0xff);
    case "image/png":
      return extension === "png" && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return extension === "webp" && asciiPrefix(4) === "RIFF" && asciiPrefix(12).slice(8) === "WEBP";
    case "text/plain":
      if (extension !== "txt" || bytes.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function toCommentDto(
  itemId: string,
  record: InventoryItemCommentRecord,
  includeAuthorEmail: boolean,
): InventoryItemCommentDto {
  return {
    id: record.id,
    authorName: record.authorName,
    authorEmail: includeAuthorEmail ? record.authorEmail : null,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    attachment: record.attachment
      ? {
          ...record.attachment,
          downloadUrl: `/api/inventory/items/${itemId}/comments/${record.id}/attachments/${record.attachment.id}`,
        }
      : null,
  };
}
