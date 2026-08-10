import { z } from "zod";

export const databaseTargets = ["development", "test", "production"] as const;
export type DatabaseTarget = (typeof databaseTargets)[number];
export type DatabasePurpose = "runtime" | "migration";
export type DatabaseSslMode = "disable" | "require" | "verify-full";

type Environment = Record<string, string | undefined>;

const targetSchema = z.enum(databaseTargets);
const sslModeSchema = z.enum(["disable", "require", "verify-full"]);
const requiredValueSchema = z.string().trim().min(1);
const deploymentIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const LIMITS = {
  connectionTimeoutMs: { min: 100, max: 60_000 },
  idleTimeoutMs: { min: 1_000, max: 600_000 },
  migrationLockTimeoutMs: { min: 1_000, max: 300_000 },
  poolMax: { min: 1, max: 50 },
  statementTimeoutMs: { min: 1_000, max: 300_000 },
} as const;

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseOperationError";
  }
}

export interface DatabaseConfig {
  applicationName: string;
  connectionString: string;
  connectionTimeoutMs: number;
  databaseName: string;
  deploymentId: string;
  idleTimeoutMs: number;
  migrationLockTimeoutMs: number;
  poolMax: number;
  purpose: DatabasePurpose;
  runtimeConnectionString: string;
  runtimeUsername: string;
  sslCa?: string;
  sslMode: DatabaseSslMode;
  statementTimeoutMs: number;
  target: DatabaseTarget;
}

interface ReadDatabaseConfigOptions {
  env?: Environment;
  purpose?: DatabasePurpose;
  target?: DatabaseTarget;
}

interface ParsedDatabaseUrl {
  databaseName: string;
  identity: string;
  url: URL;
  username: string;
}

export function databaseTargetFromNodeEnv(
  nodeEnv: string | undefined,
): DatabaseTarget {
  const parsed = targetSchema.safeParse(nodeEnv);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(
      "NODE_ENV must be explicitly set to development, test, or production before the database is used.",
    );
  }

  return parsed.data;
}

export function applicationDatabaseTarget(
  env: Environment = process.env,
): DatabaseTarget {
  const configuredTarget = env.DATABASE_TARGET?.trim();
  if (configuredTarget) return parseDatabaseTarget(configuredTarget);

  const nodeTarget = databaseTargetFromNodeEnv(env.NODE_ENV);
  if (
    nodeTarget === "production" &&
    env.NEXT_DIST_DIR === ".next-e2e" &&
    env.YU_INVENTORY_E2E_DATABASE_TARGET === "test"
  ) {
    return "test";
  }
  return nodeTarget;
}

export function parseDatabaseTarget(value: string): DatabaseTarget {
  const parsed = targetSchema.safeParse(value);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(
      "Database target must be development, test, or production.",
    );
  }

  return parsed.data;
}

export function readDatabaseConfig({
  env = process.env,
  purpose = "runtime",
  target = databaseTargetFromNodeEnv(env.NODE_ENV),
}: ReadDatabaseConfigOptions = {}): DatabaseConfig {
  const runtimeKey = target === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const migratorKey =
    target === "test"
      ? "TEST_DATABASE_MIGRATOR_URL"
      : "DATABASE_MIGRATOR_URL";
  const runtimeUrl = readRequiredValue(env, runtimeKey);
  const parsedRuntimeUrl = parseDatabaseUrl(runtimeUrl, runtimeKey);
  const deploymentId = readDeploymentId(env, target);

  assertTargetDatabaseName(target, parsedRuntimeUrl.databaseName, runtimeKey);
  assertTestIsolation(env, parsedRuntimeUrl, target, deploymentId);

  let selectedUrl = parsedRuntimeUrl;

  if (purpose === "migration") {
    const configuredMigratorUrl = env[migratorKey]?.trim();

    if (
      (target === "production" || target === "test") &&
      !configuredMigratorUrl
    ) {
      throw new DatabaseConfigurationError(
        `${migratorKey} is required for ${target} migrations.`,
      );
    }

    if (configuredMigratorUrl) {
      const parsedMigratorUrl = parseDatabaseUrl(
        configuredMigratorUrl,
        migratorKey,
      );

      if (parsedMigratorUrl.databaseName !== parsedRuntimeUrl.databaseName) {
        throw new DatabaseConfigurationError(
          `${migratorKey} must use the same case-sensitive database name as ${runtimeKey}.`,
        );
      }

      if (
        (target === "production" || target === "test") &&
        parsedMigratorUrl.username === parsedRuntimeUrl.username
      ) {
        throw new DatabaseConfigurationError(
          `${migratorKey} must use a different PostgreSQL role than ${runtimeKey}.`,
        );
      }

      selectedUrl = parsedMigratorUrl;
    }
  }

  const settingPrefix = target === "test" ? "TEST_DATABASE_" : "DATABASE_";
  const sslMode = readSslMode(env, settingPrefix, target);
  const sslCa = readOptionalSetting(env, settingPrefix, "SSL_CA");

  if (target === "production" && sslMode === "disable") {
    throw new DatabaseConfigurationError(
      "Production database connections must use TLS.",
    );
  }

  if (
    target === "production" &&
    sslMode === "require" &&
    env.DATABASE_ALLOW_UNVERIFIED_TLS !== "true"
  ) {
    throw new DatabaseConfigurationError(
      "Production TLS must use verify-full unless DATABASE_ALLOW_UNVERIFIED_TLS=true is explicitly set for a trusted private network.",
    );
  }

  if (sslCa && sslMode !== "verify-full") {
    throw new DatabaseConfigurationError(
      `${settingPrefix}SSL_CA can only be used with verify-full TLS mode.`,
    );
  }

  return {
    applicationName: `yu-inventory-${target}-${purpose}`,
    connectionString: selectedUrl.url.toString(),
    connectionTimeoutMs: readIntegerSetting(
      env,
      settingPrefix,
      "CONNECTION_TIMEOUT_MS",
      5_000,
      LIMITS.connectionTimeoutMs,
    ),
    databaseName: selectedUrl.databaseName,
    deploymentId,
    idleTimeoutMs: readIntegerSetting(
      env,
      settingPrefix,
      "IDLE_TIMEOUT_MS",
      30_000,
      LIMITS.idleTimeoutMs,
    ),
    migrationLockTimeoutMs: readIntegerSetting(
      env,
      settingPrefix,
      "MIGRATION_LOCK_TIMEOUT_MS",
      60_000,
      LIMITS.migrationLockTimeoutMs,
    ),
    poolMax: readIntegerSetting(
      env,
      settingPrefix,
      "POOL_MAX",
      target === "production" ? 10 : target === "test" ? 2 : 5,
      LIMITS.poolMax,
    ),
    purpose,
    runtimeConnectionString: parsedRuntimeUrl.url.toString(),
    runtimeUsername: parsedRuntimeUrl.username,
    sslCa,
    sslMode,
    statementTimeoutMs: readIntegerSetting(
      env,
      settingPrefix,
      "STATEMENT_TIMEOUT_MS",
      30_000,
      LIMITS.statementTimeoutMs,
    ),
    target,
  };
}

function readRequiredValue(env: Environment, key: string): string {
  const parsed = requiredValueSchema.safeParse(env[key]);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(`${key} is required.`);
  }

  return parsed.data;
}

function parseDatabaseUrl(value: string, key: string): ParsedDatabaseUrl {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new DatabaseConfigurationError(
      `${key} must be a valid PostgreSQL connection URL.`,
    );
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseConfigurationError(
      `${key} must use the postgres or postgresql protocol.`,
    );
  }

  if (!url.hostname || !url.username) {
    throw new DatabaseConfigurationError(
      `${key} must include a hostname and username.`,
    );
  }

  if (url.hash) {
    throw new DatabaseConfigurationError(`${key} must not include a fragment.`);
  }

  if (url.search) {
    throw new DatabaseConfigurationError(
      `${key} must not include query parameters; configure every connection option with dedicated database environment settings.`,
    );
  }

  const encodedDatabaseName = url.pathname.slice(1);

  if (!encodedDatabaseName || encodedDatabaseName.includes("/")) {
    throw new DatabaseConfigurationError(
      `${key} must include exactly one database name.`,
    );
  }

  let databaseName: string;
  let username: string;

  try {
    databaseName = decodeURIComponent(encodedDatabaseName);
    username = decodeURIComponent(url.username);
  } catch {
    throw new DatabaseConfigurationError(
      `${key} contains invalid URL encoding.`,
    );
  }

  if (!databaseName.trim()) {
    throw new DatabaseConfigurationError(
      `${key} must include a non-empty database name.`,
    );
  }

  const port = url.port || "5432";
  const identity = `${url.hostname.toLowerCase()}:${port}/${databaseName}`;

  return { databaseName, identity, url, username };
}

function assertTargetDatabaseName(
  target: DatabaseTarget,
  databaseName: string,
  key: string,
) {
  const isTestDatabase = databaseName.toLowerCase().endsWith("_test");

  if (target === "test" && !isTestDatabase) {
    throw new DatabaseConfigurationError(
      `${key} must use a database name ending in _test.`,
    );
  }

  if (target !== "test" && isTestDatabase) {
    throw new DatabaseConfigurationError(
      `${key} must not use a database name ending in _test outside the test environment.`,
    );
  }
}

function assertTestIsolation(
  env: Environment,
  selectedRuntimeUrl: ParsedDatabaseUrl,
  target: DatabaseTarget,
  selectedDeploymentId: string,
) {
  const comparisonKey =
    target === "test" ? "DATABASE_URL" : "TEST_DATABASE_URL";
  const comparisonValue = env[comparisonKey]?.trim();
  const comparisonDeploymentKey =
    target === "test"
      ? "DATABASE_DEPLOYMENT_ID"
      : "TEST_DATABASE_DEPLOYMENT_ID";
  const comparisonDeploymentId = env[comparisonDeploymentKey]?.trim();

  if (
    comparisonDeploymentId &&
    comparisonDeploymentId === selectedDeploymentId
  ) {
    throw new DatabaseConfigurationError(
      "Development/production and test deployment IDs must be different.",
    );
  }

  if (!comparisonValue) {
    return;
  }

  const comparisonUrl = parseDatabaseUrl(comparisonValue, comparisonKey);

  if (comparisonUrl.identity === selectedRuntimeUrl.identity) {
    throw new DatabaseConfigurationError(
      "Development/production and test database URLs must not point to the same database.",
    );
  }
}

function readDeploymentId(
  env: Environment,
  target: DatabaseTarget,
): string {
  const key =
    target === "test"
      ? "TEST_DATABASE_DEPLOYMENT_ID"
      : "DATABASE_DEPLOYMENT_ID";
  const value = readRequiredValue(env, key);
  const parsed = deploymentIdSchema.safeParse(value);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(
      `${key} must be 3-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
    );
  }

  return parsed.data;
}

function readSslMode(
  env: Environment,
  prefix: string,
  target: DatabaseTarget,
): DatabaseSslMode {
  const key = `${prefix}SSL_MODE`;
  const rawValue = env[key]?.trim();

  if (!rawValue) {
    return target === "production" ? "verify-full" : "disable";
  }

  const parsed = sslModeSchema.safeParse(rawValue);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(
      `${key} must be disable, require, or verify-full.`,
    );
  }

  return parsed.data;
}

function readOptionalSetting(
  env: Environment,
  prefix: string,
  suffix: string,
): string | undefined {
  return env[`${prefix}${suffix}`]?.trim() || undefined;
}

function readIntegerSetting(
  env: Environment,
  prefix: string,
  suffix: string,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const key = `${prefix}${suffix}`;
  const rawValue = env[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = z.coerce
    .number()
    .int()
    .min(limits.min)
    .max(limits.max)
    .safeParse(rawValue);

  if (!parsed.success) {
    throw new DatabaseConfigurationError(
      `${key} must be an integer from ${limits.min} to ${limits.max}.`,
    );
  }

  return parsed.data;
}
