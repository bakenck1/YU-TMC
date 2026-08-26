import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, test } from "node:test";
import sharp from "sharp";

import { ApplicationError } from "../lib/domain/application-error";

// `server-only` is a Next.js build-time guard. Stub only that marker for this
// direct Node test; the production module and its server-only boundary remain unchanged.
const testRequire = createRequire(import.meta.url);
const serverOnlyPath = testRequire.resolve("server-only");
const serverOnlyModule = (testRequire.cache[serverOnlyPath] ??= Object.create(null));
serverOnlyModule.exports = {};
let normalizeUploadedPhoto: typeof import(
  "../lib/server/photos/normalize-uploaded-photo"
)["normalizeUploadedPhoto"];
let isCanonicalBase64: typeof import(
  "../lib/server/photos/normalize-uploaded-photo"
)["isCanonicalBase64"];

before(async () => {
  ({ normalizeUploadedPhoto, isCanonicalBase64 } = await import(
    "../lib/server/photos/normalize-uploaded-photo"
  ));
});

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

test("accepts canonical padded and unpadded base64 boundaries", () => {
  assert.equal(isCanonicalBase64("AA=="), true);
  assert.equal(isCanonicalBase64("AA"), true);
  assert.equal(isCanonicalBase64("AAA="), true);
  assert.equal(isCanonicalBase64("AAA"), true);
  assert.equal(isCanonicalBase64("AB=="), false);
  assert.equal(isCanonicalBase64("A==="), false);
  assert.equal(isCanonicalBase64("QUI=="), false);
});

function dataUrl(mediaType: string, bytes: Uint8Array) {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function createImage(
  format: "png" | "webp" | "jpeg",
  width: number,
  height: number,
  orientation?: number,
) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  });
  const source = orientation ? image.withMetadata({ orientation }) : image;
  const bytes =
    format === "png"
      ? await source.png().toBuffer()
      : format === "webp"
        ? await source.webp().toBuffer()
        : await source.jpeg().toBuffer();
  return dataUrl(`image/${format}`, bytes);
}

async function createAnimatedWebp() {
  const createFrame = (background: { r: number; g: number; b: number }) =>
    sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background,
      },
    })
      .webp()
      .toBuffer();
  const frames = await Promise.all([
    createFrame({ r: 220, g: 40, b: 40 }),
    createFrame({ r: 40, g: 40, b: 220 }),
  ]);
  return dataUrl(
    "image/webp",
    await sharp(frames, { join: { animated: true } }).webp().toBuffer(),
  );
}

async function createTiffWithJpegLabel() {
  const bytes = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 3,
      background: { r: 32, g: 96, b: 160 },
    },
  })
    .tiff()
    .toBuffer();
  return dataUrl("image/jpeg", bytes);
}

test("normalizes supported service-request photos to bounded JPEG output", async () => {
  for (const format of ["png", "webp", "jpeg"] as const) {
    const result = await normalizeUploadedPhoto(
      await createImage(format, 2000, 1000),
    );

    assert.equal(result.mediaType, "image/jpeg");
    assert.equal(result.width, 1280);
    assert.equal(result.height, 640);
    assert.ok(result.bytes.byteLength <= MAX_PHOTO_BYTES);

    const outputMetadata = await sharp(Buffer.from(result.bytes)).metadata();
    assert.equal(outputMetadata.format, "jpeg");
    assert.equal(outputMetadata.width, 1280);
    assert.equal(outputMetadata.height, 640);
  }
});

test("auto-orients service-request photos and strips source EXIF metadata", async () => {
  const input = await createImage("jpeg", 200, 100, 6);
  const sourceBytes = Buffer.from(input.slice(input.indexOf(",") + 1), "base64");
  const sourceMetadata = await sharp(sourceBytes).metadata();
  assert.equal(sourceMetadata.orientation, 6);

  const result = await normalizeUploadedPhoto(input);
  assert.equal(result.width, 100);
  assert.equal(result.height, 200);

  const outputMetadata = await sharp(Buffer.from(result.bytes)).metadata();
  assert.equal(outputMetadata.exif, undefined);
  assert.equal(outputMetadata.orientation, undefined);
});

test("rejects unsupported, malformed, oversized and pixel-bomb service photos", async () => {
  const expectPublicCode = (publicCode: string) => (error: unknown) =>
    error instanceof ApplicationError &&
    error.kind === "validation" &&
    error.publicCode === publicCode;

  await assert.rejects(
    normalizeUploadedPhoto(
      "data:image/svg+xml;base64,PHN2Zy8+",
    ),
    expectPublicCode("invalid_camera_photo"),
  );
  const pngWithJpegLabel = (await createImage("png", 20, 20)).replace(
    "data:image/png;",
    "data:image/jpeg;",
  );
  const mismatchedMimeResult = await normalizeUploadedPhoto(pngWithJpegLabel);
  assert.equal(mismatchedMimeResult.mediaType, "image/jpeg");
  const mismatchedMimeMetadata = await sharp(
    Buffer.from(mismatchedMimeResult.bytes),
  ).metadata();
  assert.equal(mismatchedMimeMetadata.format, "jpeg");
  assert.equal(mismatchedMimeMetadata.width, 20);
  assert.equal(mismatchedMimeMetadata.height, 20);
  await assert.rejects(
    normalizeUploadedPhoto("data:image/jpeg;base64,QUI=="),
    expectPublicCode("invalid_camera_photo"),
  );
  await assert.rejects(
    normalizeUploadedPhoto(await createAnimatedWebp()),
    expectPublicCode("invalid_camera_photo"),
  );
  await assert.rejects(
    normalizeUploadedPhoto(await createTiffWithJpegLabel()),
    expectPublicCode("invalid_camera_photo"),
  );
  await assert.rejects(
    normalizeUploadedPhoto("data:image/png;base64,QQ=="),
    expectPublicCode("invalid_camera_photo"),
  );
  await assert.rejects(
    normalizeUploadedPhoto(
      dataUrl("image/jpeg", new Uint8Array(MAX_PHOTO_BYTES + 1)),
    ),
    expectPublicCode("invalid_camera_photo_size"),
  );
  const pixelBomb = await createImage("jpeg", 5001, 4000);
  const pixelBombBytes = Buffer.from(
    pixelBomb.slice(pixelBomb.indexOf(",") + 1),
    "base64",
  );
  const pixelBombMetadata = await sharp(pixelBombBytes, {
    limitInputPixels: false,
  }).metadata();
  assert.equal(pixelBombMetadata.width, 5001);
  assert.equal(pixelBombMetadata.height, 4000);
  await assert.rejects(
    normalizeUploadedPhoto(pixelBomb),
    expectPublicCode("invalid_camera_photo"),
  );
});
