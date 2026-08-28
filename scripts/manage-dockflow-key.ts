import "server-only";

import { formatDatabaseCommandError, loadTargetEnvironment } from "@/lib/db/cli";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";
import { parseDockflowKeyCommandArguments } from "@/lib/security/dockflow-key-command";
import { DockflowService } from "@/lib/server/dockflow-service";

interface AdministratorRow {
  id: string;
}

async function main() {
  const command = parseDockflowKeyCommandArguments(process.argv.slice(2));
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
    throw new Error("The exact active administrator account was not found.");
  }

  const dockflow = new DockflowService();
  const result = command.action === "rotate"
    ? await dockflow.rotateKey(administrator.rows[0].id)
    : await dockflow.createKey(administrator.rows[0].id);

  process.stderr.write(
    "Dockflow key issued. Store the next stdout line in the Dockflow backend secret store; it cannot be recovered later.\n",
  );
  process.stdout.write(`${result.key}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${formatDatabaseCommandError(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
