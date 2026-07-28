import { readFile, rm } from "node:fs/promises";
import path from "node:path";

export default async function globalTeardown() {
  if (process.platform !== "win32") return;

  const pidFile = path.resolve(".next-e2e", "playwright-server.pid");
  try {
    const pid = Number(await readFile(pidFile, "utf8"));
    if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) {
      process.kill(pid);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ESRCH") throw error;
  } finally {
    await rm(pidFile, { force: true });
  }
}
