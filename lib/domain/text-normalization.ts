export const QR_INPUT_MAX_BYTES = 512;

export type TextNormalizationError =
  | "EMPTY"
  | "PLACEHOLDER"
  | "TOO_LONG"
  | "FORBIDDEN_CHARACTER";

export type TextNormalizationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: TextNormalizationError };

const ASCII_BOUNDARY_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;
const FORBIDDEN_QR_CHARACTER =
  /[\u0000-\u001F\u007F-\u009F\u00A0\u061C\u1680\u2000-\u200A\u200E\u200F\u2028\u2029\u202F\u205F\u3000\uFEFF\u202A-\u202E\u2066-\u2069]/u;

/**
 * Applies the QR input filter from docs/qr-format.md without changing the
 * payload's internal characters. A string reaches this function only after
 * UTF-8 decoding; malformed byte input must be rejected by the HTTP/camera
 * adapter before calling it.
 */
export function normalizeQrTextInput(
  input: unknown,
): TextNormalizationResult {
  if (typeof input !== "string") {
    return { ok: false, error: "EMPTY" };
  }
  if (utf8ByteLength(input) > QR_INPUT_MAX_BYTES) {
    return { ok: false, error: "TOO_LONG" };
  }

  let value = input.startsWith("\uFEFF") ? input.slice(1) : input;
  value = value.replace(ASCII_BOUNDARY_WHITESPACE, "");

  if (!value) return { ok: false, error: "EMPTY" };
  if (value === "-" || value === "??") {
    return { ok: false, error: "PLACEHOLDER" };
  }
  if (FORBIDDEN_QR_CHARACTER.test(value)) {
    return { ok: false, error: "FORBIDDEN_CHARACTER" };
  }
  return { ok: true, value };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
