import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const E2E_DATA_DIRECTORY =
  process.env.YU_E2E_DATA_DIRECTORY ??
  path.join(tmpdir(), `yu-inventory-playwright-auth-${randomUUID()}`);

function assertSafeDirectory() {
  const resolved = path.resolve(E2E_DATA_DIRECTORY);
  const expectedParent = path.resolve(tmpdir());
  if (
    path.dirname(resolved) !== expectedParent ||
    !path.basename(resolved).startsWith("yu-inventory-playwright-auth-")
  ) {
    throw new Error(`Refusing to reset unsafe E2E directory: ${resolved}`);
  }
  return resolved;
}

export async function resetE2EData() {
  const directory = assertSafeDirectory();
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

export async function removeE2EData() {
  await rm(assertSafeDirectory(), { recursive: true, force: true });
}
