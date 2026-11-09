import { render, waitFor } from "@testing-library/react";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { afterEach, expect, it, vi } from "vitest";
import PwaRegistration from "@/components/PwaRegistration";
import { startBarcodeScanner } from "@/lib/browser-barcode-scanner";

const adapter = vi.hoisted(() => ({ formats: [] as unknown[], camera: "", detected: undefined as undefined | ((value: { getText(): string }) => void), stop: vi.fn() }));
vi.mock("@zxing/browser", () => ({ BrowserMultiFormatReader: class {
  constructor(hints: Map<unknown, unknown>) { adapter.formats = hints.get(DecodeHintType.POSSIBLE_FORMATS) as unknown[]; }
  async decodeFromConstraints(constraints: MediaStreamConstraints, _video: HTMLVideoElement, detected: (value: { getText(): string }) => void) {
    adapter.camera = ((constraints.video as MediaTrackConstraints).facingMode as ConstrainDOMStringParameters).ideal as string;
    adapter.detected = detected;
    return { stop: adapter.stop };
  }
} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("registers the notification worker only in a secure browser context", async () => {
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("isSecureContext", false);
  const unsafe = render(<PwaRegistration />);
  expect(register).not.toHaveBeenCalled();
  unsafe.unmount();
  vi.stubGlobal("isSecureContext", true);
  render(<PwaRegistration />);
  window.dispatchEvent(new Event("load"));
  await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", expect.objectContaining({ scope: "/" })));
});

it.each(["code_39", "qr_code"] as const)("decodes %s through the browser adapter and stops the camera after the first result", async (format) => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
  const detected = vi.fn();
  adapter.stop.mockReset();
  const scanner = await startBarcodeScanner({ video: document.createElement("video"), format, facingMode: "environment", onDetected: detected });
  // These are the external decoder's supported-format contract, not source text.
  expect(adapter.formats).toEqual(format === "qr_code" ? [BarcodeFormat.QR_CODE] : [BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODE_128, BarcodeFormat.CODABAR]);
  expect(adapter.camera).toBe("environment");
  adapter.detected!({ getText: () => " INV-42 " });
  adapter.detected!({ getText: () => "ignored duplicate" });
  expect(detected).toHaveBeenCalledExactlyOnceWith("INV-42");
  scanner.stop();
  expect(adapter.stop).toHaveBeenCalledOnce();
});
