import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";

export async function readHiddenPageResource<T>(
  read: () => Promise<T>,
  hide: () => never,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      (error.kind === "not_found" || error.kind === "forbidden")
    ) {
      return hide();
    }
    throw error;
  }
}
