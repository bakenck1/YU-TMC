const CODE_39_DATA_PATTERN = /^[0-9A-Z. $/+%-]+$/;

export const LOCAL_BARCODE_MAX_LENGTH = 128;

export function normalizeLocalBarcodeSource(value: unknown): string {
  if (typeof value !== "string") throw new RangeError("Invalid source barcode.");
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!normalized || normalized.length > 64 || !CODE_39_DATA_PATTERN.test(normalized)) {
    throw new RangeError("Invalid source barcode.");
  }
  return normalized;
}

export function formatLocalBarcodeSuffix(sequence: number | bigint): string {
  const value = typeof sequence === "bigint" ? sequence : BigInt(sequence);
  if (value < BigInt(1)) throw new RangeError("Local barcode sequence must be positive.");
  return value.toString().padStart(4, "0");
}

export function buildLocalBarcode(source: unknown, sequence: number | bigint): string {
  const value = `${normalizeLocalBarcodeSource(source)}-${formatLocalBarcodeSuffix(sequence)}`;
  if (value.length > LOCAL_BARCODE_MAX_LENGTH) {
    throw new RangeError("Local barcode is too long.");
  }
  return value;
}

export function localBarcodeComparisonKey(value: unknown): string {
  if (typeof value !== "string") throw new RangeError("Invalid local barcode.");
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!normalized || normalized.length > LOCAL_BARCODE_MAX_LENGTH || !CODE_39_DATA_PATTERN.test(normalized)) {
    throw new RangeError("Invalid local barcode.");
  }
  return normalized.toLocaleLowerCase("ru-RU");
}

export function isValidLocalBarcodeValue(value: unknown): value is string {
  try {
    localBarcodeComparisonKey(value);
    return true;
  } catch {
    return false;
  }
}
