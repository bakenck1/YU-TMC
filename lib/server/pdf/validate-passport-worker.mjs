import { parentPort, workerData } from 'node:worker_threads';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

// PDF.js can replace a broken compressed stream with an empty stream even
// with stopAtErrors. Its format warnings must also invalidate the upload.
// This console belongs only to this isolated worker; no PDF contents are logged.
let damaged = false;
console.warn = (...messages) => {
  if (messages.some(message => typeof message === 'string' &&
    /^Warning: .*\b(?:Invalid stream:|FormatError:)/.test(message))) damaged = true;
};

const task = getDocument({
  data: new Uint8Array(workerData.bytes),
  stopAtErrors: true,
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  verbosity: VerbosityLevel.WARNINGS,
});
try {
  const document = await task.promise;
  if (document.numPages < 1) throw new Error('empty_pdf');
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    await page.getOperatorList();
    if (damaged) throw new Error('damaged_pdf');
    page.cleanup();
  }
  parentPort.postMessage({ valid: true });
} catch {
  parentPort.postMessage({ valid: false });
} finally {
  await task.destroy();
}
