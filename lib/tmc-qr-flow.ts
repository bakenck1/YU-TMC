import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";

type QrTarget = NonNullable<QrResolutionDto["target"]>;

export type TmcQrSelectedItem = QrTarget & {
  kind: "item";
  status: "active";
};

export type TmcQrResolutionResult =
  | { kind: "selected"; item: TmcQrSelectedItem }
  | {
      kind: "error";
      reason: "invalid_code" | "not_item" | "item_unavailable";
    };

export function classifyTmcQrResolution(
  resolution: QrResolutionDto,
): TmcQrResolutionResult {
  if (
    resolution.status !== "resolved" ||
    resolution.qrStatus !== "active" ||
    !resolution.target
  ) {
    return { kind: "error", reason: "invalid_code" };
  }
  if (resolution.target.kind !== "item") {
    return { kind: "error", reason: "not_item" };
  }
  if (resolution.target.status !== "active") {
    return { kind: "error", reason: "item_unavailable" };
  }
  return {
    kind: "selected",
    item: {
      ...resolution.target,
      kind: "item",
      status: "active",
    },
  };
}
