import "server-only";
import { ApplicationError } from "@/lib/domain/application-error";

interface WaitingValidation {
  start(): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Bound parser workers and upload buffers retained while waiting for a slot. */
export class PdfValidationGate {
  private active = 0;
  private readonly waiting: WaitingValidation[] = [];

  constructor(private readonly limits = { active: 1, queued: 3, waitMs: 15_000 }) {}

  async run(work: () => Promise<void>): Promise<void> {
    await this.acquire();
    try {
      await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limits.active) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.limits.queued) return Promise.reject(overloaded());
    return new Promise<void>((resolve, reject) => {
      const entry: WaitingValidation = {
        start: resolve,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(overloaded());
        }, this.limits.waitMs),
      };
      this.waiting.push(entry);
    });
  }

  private release() {
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.start();
    } else {
      this.active -= 1;
    }
  }
}

// Next can bundle the same server module into several routes. Share capacity
// across those module copies rather than creating one queue per route bundle.
const processState = globalThis as typeof globalThis & {
  __yuPassportPdfGate?: PdfValidationGate;
};
export function passportPdfGate() {
  return processState.__yuPassportPdfGate ??= new PdfValidationGate();
}

function overloaded() {
  return new ApplicationError("unavailable", "passport_pdf_busy");
}
