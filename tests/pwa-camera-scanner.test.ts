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
