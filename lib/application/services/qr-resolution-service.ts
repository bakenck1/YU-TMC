import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import type {
  QrResolutionRecord,
  QrResolutionRepositories,
} from "@/lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";
import {
  inventoryNumberComparisonKey,
  parseCode39ScanInput,
} from "@/lib/domain/code39";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

export class QrResolutionService {
  constructor(
    private readonly unitOfWork: UnitOfWork<QrResolutionRepositories>,
  ) {}

  async resolve(
    input: unknown,
    actor: AuthorizationActor,
    kind: "auto" | "barcode" | "qr" = "auto",
    targetScope: "any" | "item" | "room" = "any",
  ): Promise<QrResolutionDto> {
    const fullAccess = hasPermission(actor.role, "inventory.qr.resolve_full");
    const itemAccess = hasPermission(actor.role, "inventory.qr.resolve_item");
    const roomAccess = hasPermission(actor.role, "inventory.qr.resolve_room");
    if (!fullAccess && !itemAccess && !roomAccess) {
      throw new ApplicationError("forbidden", "forbidden");
    }

    if (kind === "barcode") {
      const barcode = parseCode39ScanInput(input);
      if (!barcode.ok) {
        throw new ApplicationError("validation", "invalid_qr");
      }
      const record = await this.unitOfWork.read(({ qr }) =>
        qr.findItemByBarcode(
          barcode.value,
          inventoryNumberComparisonKey(barcode.inventoryNumber),
          barcode.fallbackKey,
        ),
      );
      if (
        !record ||
        !isRecordAccessible(record, {
          fullAccess,
          itemAccess,
          roomAccess,
          targetScope,
        })
      ) {
        return {
          status: "unknown",
          canonicalKey: barcode.value,
          format: "legacy_raw",
          qrStatus: null,
          target: null,
        };
      }
      return toDto(record, fullAccess, actor.userId);
    }

    const parsed = parseQrIdentifierInput(input);
    if (!parsed.ok) {
      throw new ApplicationError(
        "validation",
        parsed.error === "UNSUPPORTED_VERSION"
          ? "unsupported_qr_version"
          : "invalid_qr",
      );
    }

    const record = await this.unitOfWork.read(async ({ qr }) => {
      const qrRecord = await qr.findByCanonicalKey(parsed.canonicalKey);
      if (qrRecord || kind === "qr") return qrRecord;
      const barcode = parseCode39ScanInput(parsed.originalValue);
      if (!barcode.ok) return null;
      return qr.findItemByBarcode(
        barcode.value,
        inventoryNumberComparisonKey(barcode.inventoryNumber),
        barcode.fallbackKey,
      );
    });
    if (
      !record ||
      !isRecordAccessible(record, {
        fullAccess,
        itemAccess,
        roomAccess,
        targetScope,
      })
    ) {
      return {
        status:
          parsed.format === "generated_v1"
            ? "unissued_system_code"
            : "unknown",
        canonicalKey: parsed.canonicalKey,
        format: parsed.format,
        qrStatus: null,
        target: null,
      };
    }

    return toDto(record, fullAccess, actor.userId);
  }
}

// A physical code is not a universal capability. Inaccessible and absent
// records intentionally share the same resolver result to avoid an existence
// oracle for revoked, inactive, or out-of-scope targets.
function isRecordAccessible(
  record: QrResolutionRecord,
  access: {
    fullAccess: boolean;
    itemAccess: boolean;
    roomAccess: boolean;
    targetScope: "any" | "item" | "room";
  },
): boolean {
  if (
    access.targetScope !== "any" &&
    record.targetKind !== access.targetScope
  ) {
    return false;
  }
  if (access.fullAccess) return true;
  return !(
    record.qrStatus !== "active" ||
    record.targetStatus !== "active" ||
    !(
      (record.targetKind === "item" && access.itemAccess) ||
      (record.targetKind === "room" &&
        access.targetScope === "room" &&
        access.roomAccess)
    )
  );
}

function toDto(
  record: QrResolutionRecord,
  includeAllResponsibleNames: boolean,
  actorUserId: string,
): QrResolutionDto {
  const isCurrentUserResponsible =
    record.responsibleUserId === actorUserId;
  return {
    status: record.qrStatus === "revoked" ? "revoked" : "resolved",
    canonicalKey: record.canonicalKey,
    format: record.format,
    qrStatus: record.qrStatus,
    target: {
      kind: record.targetKind,
      id: record.targetId,
      status: record.targetStatus,
      title: record.title,
      buildingName: record.buildingName ?? undefined,
      roomDesignation: record.roomDesignation ?? undefined,
      inventoryNumber: record.inventoryNumber ?? undefined,
      responsibleName:
        includeAllResponsibleNames || isCurrentUserResponsible
        ? record.responsibleName
        : undefined,
      isAssigned:
        typeof record.responsibleUserId === "string" &&
        record.responsibleUserId.length > 0,
      isCurrentUserResponsible,
    },
  };
}
