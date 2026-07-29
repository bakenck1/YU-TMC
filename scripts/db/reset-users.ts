import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { DatabaseOperationError, readDatabaseConfig } from "@/lib/db/env";
import { createPostgresPool } from "@/lib/db/pool";

const CONFIRMATION = "DELETE_ALL_USERS";

async function main() {
  const target = parseTargetArgument(process.argv.slice(2).filter(
    (argument) => !argument.startsWith("--confirm="),
  ));
  const confirmation = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);

  if (target !== "development") {
    throw new DatabaseOperationError(
      "This command only removes accounts from the development database.",
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new DatabaseOperationError(
      `Pass --confirm=${CONFIRMATION} to remove all development accounts.`,
    );
  }

  loadTargetEnvironment(target);
  const config = readDatabaseConfig({ purpose: "migration", target });
  const pool = createPostgresPool(config, { max: 1 });

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const count = await client.query<{ count: number }>(
        `select count(*)::int as count
           from "yu_inventory"."users"
          where deleted_at is null`,
      );
      await client.query(
        `delete from "yu_inventory"."user_password_credentials"
          where user_id in (
            select id from "yu_inventory"."users" where deleted_at is null
          )`,
      );
      await client.query(
        `update "yu_inventory"."users"
            set email = 'deleted-' || id::text || '@deleted.local',
                full_name = 'Deleted account',
                phone = null,
                email_verified = false,
                is_active = false,
                deactivated_at = coalesce(deactivated_at, now()),
                deleted_at = now(),
                updated_at = now(),
                version = version + 1
          where deleted_at is null`,
      );
      await client.query(
        `update "yu_inventory"."auth_bootstrap"
            set completed_at = null, first_admin_user_id = null
          where singleton = true`,
      );
      await client.query("commit");
      console.log(
        `Removed ${count.rows[0]?.count ?? 0} development account(s). Existing inventory records were preserved.`,
      );
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
