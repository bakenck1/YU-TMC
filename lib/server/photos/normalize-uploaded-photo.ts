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
  // The media type in a data URL is attacker controlled.  Check the file
  // signature before handing bytes to Sharp so an AVIF/HEIF payload cannot be
  // smuggled into the native libheif decoder as a JPEG/PNG/WebP upload.
  if (!matchesDeclaredImageFormat(source, match[1])) throw invalidPhoto();
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

function matchesDeclaredImageFormat(
  source: Uint8Array,
  declared: string,
): boolean {
  if (declared === "jpeg") {
    return source.byteLength >= 3 &&
      source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff;
  }
  if (declared === "png") {
    return source.byteLength >= 8 &&
      source[0] === 0x89 && source[1] === 0x50 && source[2] === 0x4e &&
      source[3] === 0x47 && source[4] === 0x0d && source[5] === 0x0a &&
      source[6] === 0x1a && source[7] === 0x0a;
  }
  return declared === "webp" && source.byteLength >= 12 &&
    source[0] === 0x52 && source[1] === 0x49 && source[2] === 0x46 &&
    source[3] === 0x46 && source[8] === 0x57 && source[9] === 0x45 &&
    source[10] === 0x42 && source[11] === 0x50;
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
