export type ApplicationErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_media_type"
  | "precondition_failed"
  | "unavailable";

const APPLICATION_ERROR_KINDS = new Set<ApplicationErrorKind>([
  "validation",
  "not_found",
  "conflict",
  "unauthorized",
  "forbidden",
  "rate_limited",
  "payload_too_large",
  "unsupported_media_type",
  "precondition_failed",
  "unavailable",
]);

export class ApplicationError extends Error {
  readonly kind: ApplicationErrorKind;
  readonly publicCode: string;
  readonly safeDetails?: Readonly<Record<string, string>>;

  constructor(
    kind: ApplicationErrorKind,
    publicCode: string,
    options: {
      cause?: unknown;
      message?: string;
      safeDetails?: Readonly<Record<string, string>>;
    } = {},
  ) {
    super(options.message ?? publicCode, { cause: options.cause });
    this.name = "ApplicationError";
    this.kind = kind;
    this.publicCode = publicCode;
    this.safeDetails = options.safeDetails;
  }

  /**
   * Next.js can place route handlers and persistence code in separate server
   * bundles. An ApplicationError created by one bundle then has a different
   * constructor from the copy imported by another bundle. Recognize the
   * deliberately small public error shape so those errors keep their intended
   * HTTP status instead of being misreported as an unavailable service.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    return isApplicationError(value);
  }
}

export function isApplicationError(value: unknown): value is ApplicationError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    name?: unknown;
    kind?: unknown;
    publicCode?: unknown;
    safeDetails?: unknown;
  };
  if (
    candidate.name !== "ApplicationError" ||
    typeof candidate.kind !== "string" ||
    !APPLICATION_ERROR_KINDS.has(candidate.kind as ApplicationErrorKind) ||
    typeof candidate.publicCode !== "string" ||
    candidate.publicCode.length < 1 ||
    candidate.publicCode.length > 128
  ) {
    return false;
  }
  if (candidate.safeDetails === undefined) return true;
  if (
    typeof candidate.safeDetails !== "object" ||
    candidate.safeDetails === null ||
    Array.isArray(candidate.safeDetails)
  ) {
    return false;
  }
  return Object.values(candidate.safeDetails).every(
    (detail) => typeof detail === "string",
  );
}

export function validationError(publicCode: string) {
  return new ApplicationError("validation", publicCode);
}
