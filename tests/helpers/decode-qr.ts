import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import sharp from "sharp";

/** Decode the delivered image, independently of the QR encoder's options. */
export async function decodeQrImage(dataUrl: string): Promise<string> {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
    .flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)), new Map([[DecodeHintType.PURE_BARCODE, true]])).getText();
}
