import {
  ITEM_STATUSES,
  QR_FORMATS,
  QR_STATUSES,
  QR_TARGET_KINDS,
  RECORD_STATUSES,
} from "@/lib/contracts/inventory-domain";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import {
  classifyTmcQrResolution,
  type TmcQrSelectedItem,
} from "@/lib/tmc-qr-flow";

export type TmcQrFlowState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "selected"; item: TmcQrSelectedItem }
  | {
      status: "error";
      reason:
        | "invalid_code"
        | "not_item"
        | "item_unavailable"
        | "request_failed";
    };

interface QrFetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type TmcQrFetcher = (
  url: string,
  init: { credentials: "same-origin"; cache: "no-store"; signal: AbortSignal },
) => Promise<QrFetchResponse>;

export class TmcItemQrResolverController {
  private sequence = 0;
  private inFlight = false;
  private disposed = false;
  private controller: AbortController | null = null;

  constructor(
    private readonly options: {
      fetcher: TmcQrFetcher;
      onState(state: TmcQrFlowState): void;
    },
  ) {}

  async resolve(value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized || this.inFlight || this.disposed) return;

    this.inFlight = true;
    const sequence = ++this.sequence;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ status: "resolving" });

    try {
      const response = await this.options.fetcher(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(normalized)}&kind=barcode&target=item`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const body = await response.json();
      if (!this.isCurrent(sequence)) return;
      const resolution = response.ok ? parseResolutionBody(body) : null;
      if (!resolution) {
        this.publish({ status: "error", reason: "request_failed" });
        return;
      }

      const result = classifyTmcQrResolution(resolution);
      this.publish(
        result.kind === "selected"
          ? { status: "selected", item: result.item }
          : { status: "error", reason: result.reason },
      );
    } catch (error) {
      if (!this.isCurrent(sequence)) return;
      this.publish(
        isAbortError(error)
          ? { status: "idle" }
          : { status: "error", reason: "request_failed" },
      );
    } finally {
      if (this.isCurrent(sequence)) {
        this.inFlight = false;
        this.controller = null;
      }
    }
  }

  reset(): void {
    if (this.disposed) return;
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
    this.inFlight = false;
    this.publish({ status: "idle" });
  }

  dispose(): void {
    this.disposed = true;
    this.sequence += 1;
    this.controller?.abort();
    this.controller = null;
    this.inFlight = false;
  }

  private isCurrent(sequence: number): boolean {
    return !this.disposed && sequence === this.sequence;
  }

  private publish(state: TmcQrFlowState): void {
    if (!this.disposed) this.options.onState(state);
  }
}

export function installTmcQrResolverController(
  target: { current: TmcItemQrResolverController | null },
  options: {
    fetcher: TmcQrFetcher;
    onState(state: TmcQrFlowState): void;
  },
): () => void {
  const controller = new TmcItemQrResolverController(options);
  target.current = controller;
  return () => {
    controller.dispose();
    if (target.current === controller) target.current = null;
  };
}

function parseResolutionBody(body: unknown): QrResolutionDto | null {
  if (!isObject(body) || !isObject(body.resolution)) return null;
  const resolution = body.resolution;
  if (
    !isOneOf(resolution.status, [
      "resolved",
      "revoked",
      "unissued_system_code",
      "unknown",
    ]) ||
    typeof resolution.canonicalKey !== "string" ||
    !isOneOf(resolution.format, QR_FORMATS) ||
    !(
      resolution.qrStatus === null ||
      isOneOf(resolution.qrStatus, QR_STATUSES)
    )
  ) {
    return null;
  }
  if (resolution.status === "resolved" && resolution.qrStatus !== "active") {
    return null;
  }
  if (resolution.target === null) {
    return resolution.status === "resolved"
      ? null
      : (resolution as unknown as QrResolutionDto);
  }
  if (!isObject(resolution.target)) return null;

  const target = resolution.target;
  if (
    !isOneOf(target.kind, QR_TARGET_KINDS) ||
    typeof target.id !== "string" ||
    !target.id ||
    !isOneOf(target.status, [...RECORD_STATUSES, ...ITEM_STATUSES]) ||
    typeof target.title !== "string" ||
    !target.title ||
    !optionalString(target.buildingName) ||
    !optionalString(target.roomDesignation) ||
    !optionalString(target.inventoryNumber) ||
    !optionalNullableString(target.responsibleName) ||
    typeof target.isAssigned !== "boolean" ||
    !optionalBoolean(target.isCurrentUserResponsible)
  ) {
    return null;
  }
  return resolution as unknown as QrResolutionDto;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
