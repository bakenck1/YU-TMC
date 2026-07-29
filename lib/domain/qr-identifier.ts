import type { QrFormat } from "@/lib/contracts/inventory-domain";
import { normalizeQrTextInput } from "@/lib/domain/text-normalization";

export const QR_V1_PREFIX = "YUQ1:";
export const QR_TOKEN_LENGTH = 26;
export const QR_ENTROPY_BYTES = 16;
export const CROCKFORD_BASE32_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TOKEN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TOKEN_LIKE_PATTERN = /^[0-9A-Z]{26}$/;
const VERSIONED_PREFIX_PATTERN = /^YUQ(\d+):/;

export type QrIdentifierError = "INVALID" | "UNSUPPORTED_VERSION";

export type ParsedQrIdentifier =
  | {
      readonly ok: true;
      readonly canonicalKey: string;
      readonly format: QrFormat;
      readonly originalValue: string;
    }
  | {
      readonly ok: false;
      readonly error: QrIdentifierError;
    };

/**
 * Canonicalizes generated identifiers and validates the reserved YUQ
 * namespace. Legacy aliases keep their exact filtered text.
 */
export function parseQrIdentifierInput(input: unknown): ParsedQrIdentifier {
  const normalized = normalizeQrTextInput(input);
  if (!normalized.ok) return { ok: false, error: "INVALID" };

  const originalValue = normalized.value;
  const uppercase = originalValue.toUpperCase();
  const fullToken = uppercase.startsWith(QR_V1_PREFIX)
    ? uppercase.slice(QR_V1_PREFIX.length)
    : null;

  if (fullToken !== null) {
    if (!TOKEN_PATTERN.test(fullToken)) {
      return { ok: false, error: "INVALID" };
    }
    return generatedResult(originalValue, fullToken);
  }

  const versionMatch = uppercase.match(VERSIONED_PREFIX_PATTERN);
  if (versionMatch) {
    return {
      ok: false,
      error: versionMatch[1] === "1" ? "INVALID" : "UNSUPPORTED_VERSION",
    };
  }
  if (uppercase.startsWith("YUQ")) {
    return { ok: false, error: "INVALID" };
  }

  if (TOKEN_PATTERN.test(uppercase)) {
    return generatedResult(originalValue, uppercase);
  }
  if (TOKEN_LIKE_PATTERN.test(uppercase)) {
    return { ok: false, error: "INVALID" };
  }

  return {
    ok: true,
    canonicalKey: originalValue,
    format: looksLikeUrl(originalValue) ? "legacy_url" : "legacy_raw",
    originalValue,
  };
}

/**
 * Converts exactly 128 bits of caller-provided cryptographic entropy to the
 * canonical 26-character Crockford Base32 payload. Production callers must
 * supply entropy from a CSPRNG; accepting bytes keeps this domain module pure.
 */
export function qrIdentifierFromEntropy(entropy: Uint8Array): string {
  if (entropy.byteLength !== QR_ENTROPY_BYTES) {
    throw new RangeError(
      `QR entropy must contain exactly ${QR_ENTROPY_BYTES} bytes.`,
    );
  }

  const bits = `00${Array.from(entropy, (byte) =>
    byte.toString(2).padStart(8, "0"),
  ).join("")}`;
  const token = Array.from(
    { length: QR_TOKEN_LENGTH },
    (_, index) =>
      CROCKFORD_BASE32_ALPHABET[
        Number.parseInt(bits.slice(index * 5, index * 5 + 5), 2)
      ],
  ).join("");
  return `${QR_V1_PREFIX}${token}`;
}

function generatedResult(
  originalValue: string,
  token: string,
): ParsedQrIdentifier {
  return {
    ok: true,
    canonicalKey: `${QR_V1_PREFIX}${token}`,
    format: "generated_v1",
    originalValue,
  };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}
