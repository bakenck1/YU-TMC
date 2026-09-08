import { ApplicationError } from "@/lib/domain/application-error";
import { parseQrIdentifierInput } from "@/lib/domain/qr-identifier";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { emitLegacyUsage, observeHttpRequest } from "@/lib/server/observability";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
};

export function GET(request: Request) {
  return observeHttpRequest(request, "/api/inventory/qr/resolve", () => resolveQr(request));
}

async function resolveQr(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("value");
  let legacyVariant = legacyVariantFor(value);
  let legacyUsageEmitted = false;
  const emitQrUsage = (outcome: "resolved" | "not_found" | "rejected" | "failed") => {
    if (!legacyVariant || legacyUsageEmitted) return;
    legacyUsageEmitted = true;
    emitLegacyUsage({
      compatibilityId: "LEGACY-QR-ALIASES",
      variant: legacyVariant,
      outcome,
    });
  };
  try {
    const user = await requireCurrentUser(request);
    if (!value) throw new ApplicationError("validation", "qr_value_required");
    const kindInput = url.searchParams.get("kind");
    const kind =
      kindInput === "barcode" || kindInput === "qr" ? kindInput : "auto";
    const targetInput = url.searchParams.get("target");
    const target =
      targetInput === "item" || targetInput === "room" ? targetInput : "any";
    if (kind !== "qr" && target !== "room") {
      const localGroup = await getApplicationServices().localBarcodes.resolveBarcode(
        value,
        authorizationActor(user),
      );
      if (localGroup) {
        emitQrUsage(localGroup.status === "cancelled" ? "rejected" : "resolved");
        const scannedPhotoUrl = localGroup.photoUrl
          ? `/api/inventory/qr/item-photo?value=${encodeURIComponent(localGroup.localBarcode)}&kind=barcode`
          : null;
        return Response.json({
          resolution: {
            status: localGroup.status === "cancelled" ? "cancelled" : "resolved",
            canonicalKey: localGroup.localBarcode,
            format: "legacy_raw",
            qrStatus: localGroup.status === "cancelled" ? "revoked" : "active",
            target: {
              kind: "item",
              id: localGroup.itemId,
              status: "active",
              title: localGroup.itemName,
              buildingName: localGroup.location.buildingName,
              roomDesignation: localGroup.location.roomDesignation,
              inventoryNumber: localGroup.localBarcode,
              responsibleName: localGroup.responsible.fullName,
              responsibleId: localGroup.responsible.id,
              isAssigned: true,
              isCurrentUserResponsible: localGroup.responsible.id === user.userId,
              itemDetails: {
                itemType: localGroup.itemType,
                brand: localGroup.brand,
                model: localGroup.model,
                description: localGroup.description,
                quantity: localGroup.quantity,
                unitPrice: localGroup.unitPrice,
                condition: localGroup.condition ?? "good",
                connectionStatus:
                  localGroup.connectionStatus ?? "not_applicable",
                photoUrl: scannedPhotoUrl,
                createdAt: localGroup.transferredAt,
              },
              localGroup: {
                id: localGroup.id,
                localBarcode: localGroup.localBarcode,
                originalBarcode: localGroup.originalBarcode,
                quantity: localGroup.quantity,
                version: localGroup.version,
                transferredAt: localGroup.transferredAt,
                status: localGroup.status,
                previousResponsible: localGroup.previousResponsible,
              },
            },
          },
        }, { headers: PRIVATE_HEADERS });
      }
    }
    const resolution = await getApplicationServices().qr.resolve(
      value,
      authorizationActor(user),
      kind,
      target,
    );
    if (resolution.format === "legacy_raw" || resolution.format === "legacy_url") {
      legacyVariant = resolution.format;
      emitQrUsage(resolution.status === "resolved" ? "resolved" : "not_found");
    }
    if (resolution.status === "resolved" && resolution.target?.kind === "item") {
      try {
        resolution.distribution = await getApplicationServices().localBarcodes.getDistribution(
          resolution.target.id,
          authorizationActor(user),
        );
      } catch (error) {
        if (!(error instanceof ApplicationError && (error.kind === "not_found" || error.kind === "forbidden"))) throw error;
      }
    }
    return Response.json({ resolution }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    emitQrUsage(error instanceof ApplicationError ? "rejected" : "failed");
    return error instanceof ApplicationError
      ? applicationErrorResponse(error)
      : Response.json({ error: "qr_resolver_unavailable" }, { status: 503 });
  }
}

function legacyVariantFor(value: string | null): "legacy_raw" | "legacy_url" | null {
  if (!value) return null;
  const parsed = parseQrIdentifierInput(value);
  if (parsed.ok) {
    return parsed.format === "legacy_raw" || parsed.format === "legacy_url"
      ? parsed.format
      : null;
  }
  const trimmed = value.trim();
  if (/^YUQ/i.test(trimmed) || /^[0-9A-Z]{26}$/i.test(trimmed)) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? "legacy_url" : "legacy_raw";
}
