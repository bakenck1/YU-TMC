import { parseDatabaseTarget, type DatabaseTarget } from "@/lib/db/env";

export interface DockflowKeyRegistrationCommand {
  actorEmail: string;
  keyHashSha256: string;
  keyPrefix: string;
  target: DatabaseTarget;
}

export class DockflowKeyCommandError extends Error {}

export function parseDockflowKeyRegistrationCommandArguments(
  args: string[],
): DockflowKeyRegistrationCommand {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(actor-email|key-prefix|key-sha256|target)=(.+)$/u.exec(argument);
    if (!match || values.has(match[1]!)) {
      throw new DockflowKeyCommandError(
        "Pass exactly --target, --actor-email, --key-sha256, and --key-prefix.",
      );
    }
    values.set(match[1]!, match[2]!.trim());
  }

  if (values.size !== 4) {
    throw new DockflowKeyCommandError(
      "Pass exactly --target, --actor-email, --key-sha256, and --key-prefix.",
    );
  }
  let target: DatabaseTarget;
  try {
    target = parseDatabaseTarget(values.get("target")!);
  } catch {
    throw new DockflowKeyCommandError("Pass a valid explicit database target.");
  }
  if (target === "test") {
    throw new DockflowKeyCommandError(
      "Dockflow key management is unavailable for test databases.",
    );
  }
  const actorEmail = values.get("actor-email")!.toLowerCase();
  if (
    actorEmail.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@yu\.edu\.kz$/u.test(actorEmail)
  ) {
    throw new DockflowKeyCommandError(
      "Pass an exact corporate administrator email address.",
    );
  }
  const keyHashSha256 = values.get("key-sha256")!.toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(keyHashSha256)) {
    throw new DockflowKeyCommandError(
      "Pass the lowercase or uppercase 64-character SHA-256 digest.",
    );
  }
  const keyPrefix = values.get("key-prefix")!;
  if (!/^df_live_[A-Za-z0-9_-]{8}$/u.test(keyPrefix)) {
    throw new DockflowKeyCommandError(
      "Pass the non-secret 16-character df_live_ key prefix.",
    );
  }

  return { actorEmail, keyHashSha256, keyPrefix, target };
}
