import "server-only";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { MAX_PASSPORT_BYTES } from "@/lib/contracts/room-passports";
import { ApplicationError } from "@/lib/domain/application-error";
import { passportPdfGate } from "@/lib/server/pdf/pdf-validation-gate";

// Isolate parser CPU and memory from the request process. Never execute PDF scripts.
export async function validatePassportPdf(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_PASSPORT_BYTES ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw invalid();
  }
  await passportPdfGate().run(() => new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), "lib/server/pdf/validate-passport-worker.mjs"), {
      // Next.js forwards its globals by spreading workerData into an object.
      // Keep the typed array in a property so that spread preserves its type.
      workerData: { bytes },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    const timer = setTimeout(() => finish(false), 30_000);
    let settled = false;
    function finish(valid: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A slot is freed only once the worker has stopped, including its native
      // decoder resources. Overlapping termination cannot exceed the limit.
      void worker.terminate().then(() => {
        if (valid) resolve(); else reject(invalid());
      }, () => reject(invalid()));
    }
    worker.once("message", (message) => finish(message?.valid === true));
    worker.once("error", () => finish(false));
    worker.once("exit", () => finish(false));
  }));
}
function invalid() {
  return new ApplicationError("validation", "passport_invalid_pdf");
}
