import { parseDatabaseTarget, type DatabaseTarget } from "@/lib/db/env";

export interface DockflowKeyCommand {
  action: "create" | "rotate";
  actorEmail: string;
  target: DatabaseTarget;
}

export function parseDockflowKeyCommandArguments(
  args: string[],
): DockflowKeyCommand {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(action|actor-email|target)=(.+)$/u.exec(argument);
    if (!match || values.has(match[1]!)) {
      throw new Error(
        "Pass exactly --target, --actor-email, and --action=create|rotate.",
      );
    }
    values.set(match[1]!, match[2]!.trim());
  }

  if (values.size !== 3) {
    throw new Error(
      "Pass exactly --target, --actor-email, and --action=create|rotate.",
    );
  }
  const target = parseDatabaseTarget(values.get("target")!);
  if (target === "test") {
    throw new Error("Dockflow key management is unavailable for test databases.");
  }
  const actorEmail = values.get("actor-email")!.toLowerCase();
  if (
    actorEmail.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@yu\.edu\.kz$/u.test(actorEmail)
  ) {
    throw new Error("Pass an exact corporate administrator email address.");
  }
  const action = values.get("action");
  if (action !== "create" && action !== "rotate") {
    throw new Error("Dockflow key action must be create or rotate.");
  }

  return { action, actorEmail, target };
}
