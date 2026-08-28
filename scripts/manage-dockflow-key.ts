import "server-only";

import { formatDatabaseCommandError, loadTargetEnvironment } from "@/lib/db/cli";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import {
  DockflowKeyCommandError,
  parseDockflowKeyRegistrationCommandArguments,
} from "@/lib/security/dockflow-key-command";
import { DockflowService } from "@/lib/server/dockflow-service";

interface AdministratorRow {
  id: string;
}

async function main() {
  const command = parseDockflowKeyRegistrationCommandArguments(process.argv.slice(2));
  loadTargetEnvironment(command.target);

  const administrator = await getDatabasePool().query<AdministratorRow>(
    `select id
       from "yu_inventory"."users"
      where lower(email) = $1
        and role = 'admin'
        and is_active = true
        and deleted_at is null`,
    [command.actorEmail],
  );
  if (administrator.rowCount !== 1 || !administrator.rows[0]) {
    throw new DockflowKeyCommandError(
      "The exact active administrator account was not found.",
    );
  }

  const dockflow = new DockflowService();
  const metadata = await dockflow.registerKeyHash(administrator.rows[0].id, {
    keyHashSha256: command.keyHashSha256,
    keyPrefix: command.keyPrefix,
  });

  process.stderr.write(
    `Dockflow key digest registered (${metadata.keyPrefix}..., ${metadata.status}). The raw key never entered YU Inventory.\n`,
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof DockflowKeyCommandError
      ? error.message
      : formatDatabaseCommandError(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
