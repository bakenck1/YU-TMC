import "server-only";

import sharp from "sharp";
import { ApplicationError } from "@/lib/domain/application-error";

export async function normalizeUploadedPhoto(imageDataUrl: unknown) {
  if (typeof imageDataUrl !== "string") throw invalidPhoto();
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    imageDataUrl,
  );
  if (!match?.[2]) throw invalidPhoto();
  const source = Buffer.from(match[2], "base64");
  if (source.byteLength < 1 || source.byteLength > 5 * 1024 * 1024) {
    throw new ApplicationError("validation", "invalid_camera_photo_size");
  }
  try {
    const processed = await sharp(source, {
      failOn: "warning",
      limitInputPixels: 20_000_000,
      sequentialRead: true,
      unlimited: false,
    })
      .autoOrient()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (!processed.info.width || !processed.info.height) throw invalidPhoto();
    return {
      bytes: new Uint8Array(
        processed.data.buffer,
        processed.data.byteOffset,
        processed.data.byteLength,
      ),
      width: processed.info.width,
      height: processed.info.height,
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
