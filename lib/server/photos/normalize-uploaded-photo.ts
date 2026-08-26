import "server-only";

import sharp from "sharp";
import { ApplicationError } from "@/lib/domain/application-error";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function normalizeUploadedPhoto(imageDataUrl: unknown) {
  if (typeof imageDataUrl !== "string") throw invalidPhoto();
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    imageDataUrl,
  );
  if (!match?.[2]) throw invalidPhoto();
  if (!isCanonicalBase64(match[2])) throw invalidPhoto();
  const source = Buffer.from(match[2], "base64");
  if (source.byteLength < 1 || source.byteLength > MAX_PHOTO_BYTES) {
    throw new ApplicationError("validation", "invalid_camera_photo_size");
  }
  try {
    const processed = await sharp(source, {
      failOn: "warning",
      limitInputPixels: 20_000_000,
      sequentialRead: true,
      unlimited: false,
    });
    const metadata = await processed.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages !== undefined && metadata.pages > 1)
    ) {
      throw invalidPhoto();
    }
    const normalized = await processed
      .autoOrient()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (!normalized.info.width || !normalized.info.height) throw invalidPhoto();
    if (normalized.data.byteLength > MAX_PHOTO_BYTES) {
      throw new ApplicationError("validation", "invalid_camera_photo_size");
    }
    return {
      bytes: new Uint8Array(
        normalized.data.buffer,
        normalized.data.byteOffset,
        normalized.data.byteLength,
      ),
      width: normalized.info.width,
      height: normalized.info.height,
      mediaType: "image/jpeg" as const,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidPhoto(error);
  }
}

function invalidPhoto(cause?: unknown) {
  return new ApplicationError("validation", "invalid_camera_photo", { cause });
}

export function isCanonicalBase64(value: string) {
  if (value.length === 0) return false;
  const unpadded = value.replace(/=+$/, "");
  const paddingLength = value.length - unpadded.length;
  if (paddingLength > 2) return false;
  if (paddingLength > 0 && value.length % 4 !== 0) return false;
  if (
    (paddingLength === 1 && unpadded.length % 4 !== 3) ||
    (paddingLength === 2 && unpadded.length % 4 !== 2) ||
    (paddingLength === 0 && unpadded.length % 4 === 1) ||
    !/^[A-Za-z0-9+/]*$/.test(unpadded)
  ) {
    return false;
  }
  const canonical = Buffer.from(value, "base64").toString("base64");
  return canonical === value || canonical.replace(/=+$/, "") === value;
}
