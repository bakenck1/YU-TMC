import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import manifest from "../app/manifest";
import {
  startBarcodeScanner,
  type BarcodeDecoderStarter,
} from "../lib/browser-barcode-scanner";

const ROOT = new URL("../", import.meta.url);

test("publishes an installable standalone manifest with phone-sized icons", async () => {
  const value = manifest();

  assert.equal(value.id, "/");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.display, "standalone");
  assert.equal(value.theme_color, "#002060");
  assert.equal(value.background_color, "#f7f9f7");

  const icons = value.icons ?? [];
  assert.ok(
    icons.some((icon) => icon.src === "/icons/icon-192.png" && icon.sizes === "192x192"),
  );
  assert.ok(
    icons.some((icon) => icon.src === "/icons/icon-512.png" && icon.sizes === "512x512"),
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/icons/icon-maskable-512.png" &&
        icon.sizes === "512x512" &&
        icon.purpose === "maskable",
    ),
  );

  assert.deepEqual(await pngSize("public/icons/icon-192.png"), [192, 192]);
  assert.deepEqual(await pngSize("public/icons/icon-512.png"), [512, 512]);
  assert.deepEqual(await pngSize("public/icons/icon-maskable-512.png"), [512, 512]);
});

test("registers a network-only service worker because offline mode is out of scope", async () => {
  const [registration, worker, layout] = await Promise.all([
    source("components/PwaRegistration.tsx"),
    source("public/sw.js"),
    source("app/layout.tsx"),
  ]);

  assert.match(registration, /serviceWorker\.register\("\/sw\.js"/);
  assert.match(registration, /window\.isSecureContext/);
  assert.match(worker, /addEventListener\("install"/);
  assert.match(worker, /addEventListener\("activate"/);
  assert.match(worker, /addEventListener\("fetch"/);
  assert.match(worker, /respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(worker, /\bcaches\./);
  assert.match(layout, /<PwaRegistration \/>/);
  assert.match(layout, /export const viewport: Viewport/);
});

test("uses ZXing camera decoding for Code 39 by default and optional QR", async () => {
  const [scanner, inspections, itemScanner, roomScanner, packageJson] =
    await Promise.all([
      source("lib/browser-barcode-scanner.ts"),
      source("components/InventoryInspectionsManager.tsx"),
      source("components/InventoryItemCodeScanner.tsx"),
      source("components/InventoryRoomQrScanner.tsx"),
      source("package.json"),
    ]);

  assert.match(scanner, /import\("@zxing\/browser"\)/);
  assert.match(scanner, /BarcodeFormat\.CODE_39/);
  assert.match(scanner, /BarcodeFormat\.QR_CODE/);
  assert.match(scanner, /facingMode: \{ ideal: facingMode \}/);
  assert.match(inspections, /useState<"code_39" \| "qr_code">\(\s*"code_39"/);
  assert.match(inspections, /startBarcodeScanner\(\{/);
  assert.match(itemScanner, /startBarcodeScanner\(\{/);
  assert.match(roomScanner, /startBarcodeScanner\(\{/);
  assert.match(roomScanner, /&target=room/);
  assert.match(
    roomScanner,
    /function stopCamera\(\)[\s\S]*?setCameraState\("idle"\)/,
  );
  const dependencies = (
    JSON.parse(packageJson) as { dependencies?: Record<string, string> }
  ).dependencies;
  assert.equal(dependencies?.["@zxing/browser"], "^0.2.1");
  assert.equal(dependencies?.["@zxing/library"], "^0.23.0");
});

test("camera decoding is one-shot and cleanup is idempotent", async () => {
  await withCameraNavigator(async () => {
    let emit: ((value: string) => void) | undefined;
    let stopCount = 0;
    const detected: string[] = [];
    const video = { srcObject: { active: true } } as unknown as HTMLVideoElement;
    const starter: BarcodeDecoderStarter = async (options) => {
      emit = options.onDetected;
      return { stop: () => { stopCount += 1; } };
    };

    const session = await startBarcodeScanner(
      {
        video,
        format: "code_39",
        onDetected: (value) => detected.push(value),
      },
      starter,
    );
    emit?.("  YUB-100  ");
    emit?.("YUB-101");
    session.stop();

    assert.deepEqual(detected, ["YUB-100"]);
    assert.equal(stopCount, 1);
    assert.equal(video.srcObject, null);
  });
});

test("stops decoder when a result races decoder session assignment", async () => {
  await withCameraNavigator(async () => {
    let stopCount = 0;
    const detected: string[] = [];
    const video = { srcObject: { active: true } } as unknown as HTMLVideoElement;
    const starter: BarcodeDecoderStarter = async (options) => {
      options.onDetected("EARLY-CODE");
      return { stop: () => { stopCount += 1; } };
    };

    const session = await startBarcodeScanner(
      {
        video,
        format: "qr_code",
        onDetected: (value) => detected.push(value),
      },
      starter,
    );
    session.stop();

    assert.deepEqual(detected, ["EARLY-CODE"]);
    assert.equal(stopCount, 1);
    assert.equal(video.srcObject, null);
  });
});

async function source(relativePath: string) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

async function pngSize(relativePath: string): Promise<[number, number]> {
  const bytes = await readFile(new URL(relativePath, ROOT));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function withCameraNavigator(run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => undefined } },
  });
  try {
    await run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
}
