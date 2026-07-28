import { loadEnvConfig } from "@next/env";

import {
  DatabaseConfigurationError,
  DatabaseOperationError,
  parseDatabaseTarget,
  type DatabaseTarget,
} from "@/lib/db/env";

export function parseTargetArgument(args: string[]): DatabaseTarget {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument.startsWith("--target=")) {
      values.push(argument.slice("--target=".length));
      continue;
    }

    if (argument === "--target") {
      const value = args[index + 1];

      if (!value || value.startsWith("--")) {
        throw new DatabaseConfigurationError(
          "The --target option requires a value.",
        );
      }

      values.push(value);
      index += 1;
      continue;
    }

    throw new DatabaseConfigurationError(
      "Unsupported database command argument.",
    );
  }

  if (values.length === 1) {
    return parseDatabaseTarget(values[0]);
  }

  throw new DatabaseConfigurationError(
    "Pass exactly one explicit --target=development, --target=test, or --target=production.",
  );
}

export function loadTargetEnvironment(target: DatabaseTarget): void {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== target) {
    throw new DatabaseConfigurationError(
      `NODE_ENV is ${process.env.NODE_ENV}, but the requested database target is ${target}.`,
    );
  }

  const mutableEnvironment = process.env as Record<string, string | undefined>;
  mutableEnvironment.NODE_ENV = target;
  loadEnvConfig(process.cwd(), target === "development");
}

export function formatDatabaseCommandError(error: unknown): string {
  if (
    error instanceof DatabaseConfigurationError ||
    error instanceof DatabaseOperationError
  ) {
    return error.message;
  }

  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unknown";

  return `Database command failed (code: ${code}).`;
}
