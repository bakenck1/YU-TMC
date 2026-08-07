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
  ): Promise<QrResolutionDto> {
    const fullAccess = hasPermission(actor.role, "inventory.qr.resolve_full");
    const itemAccess = hasPermission(actor.role, "inventory.qr.resolve_item");
    if (!fullAccess && !itemAccess) {
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
      if (!record) {
        return {
          status: "unknown",
          canonicalKey: barcode.value,
          format: "legacy_raw",
          qrStatus: null,
          target: null,
        };
      }
      assertRecordAccessible(record, fullAccess);
      return toDto(record, fullAccess || itemAccess, actor.userId);
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
    if (!record) {
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
    // A physical QR is not a universal capability for employee accounts.
    // Employees may identify active items, but must receive the same opaque
    // response for foreign target kinds, revoked codes, and inactive items.
    assertRecordAccessible(record, fullAccess);

    return toDto(record, fullAccess || itemAccess, actor.userId);
  }
}

function assertRecordAccessible(
  record: QrResolutionRecord,
  fullAccess: boolean,
): void {
  if (
    !fullAccess &&
    ((record.targetKind !== "item" && record.targetKind !== "room") ||
      record.qrStatus !== "active" ||
      record.targetStatus !== "active")
  ) {
    throw new ApplicationError("not_found", "not_accessible");
  }
}

function toDto(
  record: QrResolutionRecord,
  includeResponsibleName: boolean,
  actorUserId: string,
): QrResolutionDto {
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
      responsibleName: includeResponsibleName
        ? record.responsibleName
        : undefined,
      isCurrentUserResponsible: record.responsibleUserId === actorUserId,
    },
  };
}
