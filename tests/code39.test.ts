import assert from "node:assert/strict";
import test from "node:test";

import {
  code39PayloadForItem,
  inventoryNumberComparisonKey,
  parseCode39ScanInput,
  renderCode39Svg,
} from "../lib/domain/code39";

const ITEM_ID = "0d8c3600-5d2f-4e9c-b26f-1bc773146aec";

test("uses a normalized inventory number when Code 39 can encode it", () => {
  assert.equal(code39PayloadForItem(" 050-0002369 ", ITEM_ID), "YUB-050-0002369");
  assert.equal(code39PayloadForItem("ab/12", ITEM_ID), "YUB-AB/12");
});

test("falls back to a stable item UUID for unsupported inventory numbers", () => {
  assert.equal(
    code39PayloadForItem("ТМЦ № 42", ITEM_ID),
    "YUI-0D8C36005D2F4E9C",
  );
});

test("uses the compact fallback for directly encodable but overly long values", () => {
  assert.equal(
    code39PayloadForItem("INVENTORY-NUMBER-THAT-IS-TOO-LONG", ITEM_ID),
    "YUI-0D8C36005D2F4E9C",
  );
});

test("keeps barcode namespaces independent from reserved QR input", () => {
  const payload = code39PayloadForItem("YUQ42", ITEM_ID);
  assert.equal(payload, "YUB-YUQ42");
  assert.deepEqual(parseCode39ScanInput(payload), {
    ok: true,
    value: "YUB-YUQ42",
    inventoryNumber: "YUQ42",
    fallbackKey: null,
  });
});

test("parses the compact fallback without treating it as an inventory number", () => {
  assert.deepEqual(parseCode39ScanInput("yui-0d8c36005d2f4e9c"), {
    ok: true,
    value: "YUI-0D8C36005D2F4E9C",
    inventoryNumber: "",
    fallbackKey: "0D8C36005D2F4E9C",
  });
});

test("renders a complete Code 39 SVG with start/stop guards and safe text", () => {
  const svg = renderCode39Svg("AB-12");
  assert.match(svg, /^<svg /);
  assert.match(svg, /aria-label="Code 39: AB-12"/);
  assert.match(svg, /<rect x=/);
  assert.match(svg, /<text [^>]*>AB-12<\/text>/);
  assert.match(svg, /<\/svg>$/);
});

test("rejects values outside the Code 39 alphabet", () => {
  assert.throws(() => renderCode39Svg("ABC_123"), /supports only/);
});

test("uses the same comparison rule as inventory persistence", () => {
  assert.equal(inventoryNumberComparisonKey("  АБ-１２  "), "аб-12");
});
