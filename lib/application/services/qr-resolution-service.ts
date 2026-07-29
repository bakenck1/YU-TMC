import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import type {
  QrResolutionRecord,
  QrResolutionRepositories,
} from "@/lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";
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
  ): Promise<QrResolutionDto> {
    const fullAccess = hasPermission(actor.role, "inventory.qr.resolve_full");
    const itemAccess = hasPermission(actor.role, "inventory.qr.resolve_item");
    if (!fullAccess && !itemAccess) {
      throw new ApplicationError("forbidden", "forbidden");
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

    const record = await this.unitOfWork.read(({ qr }) =>
      qr.findByCanonicalKey(parsed.canonicalKey),
    );
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
    if (!fullAccess && record.targetKind !== "item") {
      throw new ApplicationError("not_found", "not_accessible");
    }

    return toDto(record, fullAccess);
  }
}

function toDto(
  record: QrResolutionRecord,
  includeResponsibleName: boolean,
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
    },
  };
}
