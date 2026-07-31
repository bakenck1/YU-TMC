export type CameraCodeFormat = "code_39" | "qr_code";
export type CameraFacingMode = "environment" | "user";

export interface BarcodeScannerSession {
  stop(): void;
}

interface BarcodeDecoderControls {
  stop(): void;
}

export type BarcodeDecoderStarter = (options: {
  video: HTMLVideoElement;
  format: CameraCodeFormat;
  facingMode: CameraFacingMode;
  onDetected: (value: string) => void;
}) => Promise<BarcodeDecoderControls>;

export async function startBarcodeScanner({
  video,
  format,
  facingMode = "environment",
  onDetected,
}: {
  video: HTMLVideoElement;
  format: CameraCodeFormat;
  facingMode?: CameraFacingMode;
  onDetected: (value: string) => void;
}, startDecoder: BarcodeDecoderStarter = startZxingDecoder): Promise<BarcodeScannerSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("camera_unsupported");
  }

  let controls: BarcodeDecoderControls | null = null;
  let stopped = false;
  let accepted = false;

  const session: BarcodeScannerSession = {
    stop() {
      if (stopped) return;
      stopped = true;
      controls?.stop();
      video.srcObject = null;
    },
  };

  controls = await startDecoder({
    video,
    format,
    facingMode,
    onDetected(value) {
      const normalized = value.trim();
      if (!normalized || accepted || stopped) return;
      accepted = true;
      session.stop();
      onDetected(normalized);
    },
  });
  if (stopped) controls.stop();

  return session;
}

async function startZxingDecoder({
  video,
  format,
  facingMode,
  onDetected,
}: Parameters<BarcodeDecoderStarter>[0]): Promise<BarcodeDecoderControls> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
    await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
  const hints = new Map<
    import("@zxing/library").DecodeHintType,
    unknown
  >();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    format === "code_39" ? BarcodeFormat.CODE_39 : BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 120,
    delayBetweenScanSuccess: 500,
  });
  return reader.decodeFromConstraints(
    {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    video,
    (result) => {
      const value = result?.getText();
      if (value) onDetected(value);
    },
  );
}
