import type { Pool } from "pg";

import { DatabaseOperationError } from "@/lib/db/env";

/** Probe permissions without committing a deletion, even if protection is broken. */
export async function assertSettingsDeleteRejected(
  pool: Pool,
  expectedCode: "42501" | "55006",
): Promise<void> {
  const client = await pool.connect();
  let deletionError: unknown;
  let discardClient = false;
  try {
    await client.query("begin");
    try {
      await client.query(
        `delete from "yu_inventory"."settings" where id = 'global'`,
      );
    } catch (error) {
      deletionError = error;
    } finally {
      try {
        await client.query("rollback");
      } catch (error) {
        discardClient = true;
        throw error;
      }
    }
  } finally {
    client.release(discardClient);
  }

  const actualCode =
    typeof deletionError === "object" && deletionError !== null && "code" in deletionError
      ? deletionError.code
      : undefined;
  if (actualCode !== expectedCode) {
    throw new DatabaseOperationError(
      "Settings delete protection check failed; the probe transaction was rolled back.",
    );
  }
}
