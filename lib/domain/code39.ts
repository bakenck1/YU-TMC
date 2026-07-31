const CODE_39_PATTERNS: Readonly<Record<string, string>> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

const CODE_39_DATA_PATTERN = /^[0-9A-Z. $/+%-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BARCODE_INVENTORY_PREFIX = "YUB-";
const BARCODE_FALLBACK_PREFIX = "YUI-";
const MAX_DIRECT_INVENTORY_NUMBER_LENGTH = 16;

export function inventoryNumberComparisonKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

export function code39PayloadForItem(
  inventoryNumber: string,
  itemId: string,
): string {
  const candidate = inventoryNumber.normalize("NFKC").trim().toUpperCase();
  if (
    candidate.length > 0 &&
    candidate.length <= MAX_DIRECT_INVENTORY_NUMBER_LENGTH &&
    CODE_39_DATA_PATTERN.test(candidate)
  ) {
    return `${BARCODE_INVENTORY_PREFIX}${candidate}`;
  }
  if (!UUID_PATTERN.test(itemId)) {
    throw new RangeError("A UUID item id is required for the Code 39 fallback.");
  }
  return `${BARCODE_FALLBACK_PREFIX}${itemId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

export type ParsedCode39Scan =
  | {
      readonly ok: true;
      readonly value: string;
      readonly inventoryNumber: string;
      readonly fallbackKey: string | null;
    }
  | { readonly ok: false };

export function parseCode39ScanInput(input: unknown): ParsedCode39Scan {
  if (typeof input !== "string") return { ok: false };
  const value = input.normalize("NFKC").trim().toUpperCase();
  if (!value || value.length > 64 || !CODE_39_DATA_PATTERN.test(value)) {
    return { ok: false };
  }
  const fallbackKey = value.match(/^YUI-([0-9A-F]{16})$/)?.[1] ?? null;
  if (fallbackKey) {
    return { ok: true, value, inventoryNumber: "", fallbackKey };
  }
  const inventoryNumber = value.startsWith(BARCODE_INVENTORY_PREFIX)
    ? value.slice(BARCODE_INVENTORY_PREFIX.length)
    : value;
  if (!inventoryNumber) return { ok: false };
  return { ok: true, value, inventoryNumber, fallbackKey: null };
}

export function renderCode39Svg(
  value: string,
  {
    moduleWidth = 2,
    barHeight = 72,
    includeText = true,
  }: {
    moduleWidth?: number;
    barHeight?: number;
    includeText?: boolean;
  } = {},
): string {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!CODE_39_DATA_PATTERN.test(normalized)) {
    throw new RangeError("Code 39 supports only 0-9, A-Z, space and . $ / + % -.");
  }
  if (!Number.isFinite(moduleWidth) || moduleWidth <= 0) {
    throw new RangeError("Code 39 module width must be positive.");
  }
  if (!Number.isFinite(barHeight) || barHeight <= 0) {
    throw new RangeError("Code 39 bar height must be positive.");
  }

  const encoded = `*${normalized}*`;
  const quietZone = 10;
  const wideRatio = 3;
  let cursor = quietZone;
  const rectangles: string[] = [];

  for (const [characterIndex, character] of Array.from(encoded).entries()) {
    const pattern = CODE_39_PATTERNS[character];
    if (!pattern) throw new RangeError(`Unsupported Code 39 character: ${character}`);
    for (const [elementIndex, widthKind] of Array.from(pattern).entries()) {
      const width = widthKind === "w" ? wideRatio : 1;
      if (elementIndex % 2 === 0) {
        rectangles.push(
          `<rect x="${cursor * moduleWidth}" y="0" width="${width * moduleWidth}" height="${barHeight}"/>`,
        );
      }
      cursor += width;
    }
    if (characterIndex < encoded.length - 1) cursor += 1;
  }

  const width = (cursor + quietZone) * moduleWidth;
  const textHeight = includeText ? 24 : 0;
  const height = barHeight + textHeight;
  const label = escapeXml(normalized);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Code 39: ${label}" shape-rendering="crispEdges">`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    `<g fill="#000">${rectangles.join("")}</g>`,
    includeText
      ? `<text x="${width / 2}" y="${barHeight + 18}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" fill="#000" shape-rendering="geometricPrecision">${label}</text>`
      : "",
    "</svg>",
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
