export type ApplicationErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "precondition_failed"
  | "unavailable";

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
}

export function validationError(publicCode: string) {
  return new ApplicationError("validation", publicCode);
}
