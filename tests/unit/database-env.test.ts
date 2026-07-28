import { describe, expect, it } from "vitest";

import {
  formatDatabaseCommandError,
  parseTargetArgument,
} from "@/lib/db/cli";
import {
  DatabaseConfigurationError,
  DatabaseOperationError,
  applicationDatabaseTarget,
  databaseTargetFromNodeEnv,
  parseDatabaseTarget,
  readDatabaseConfig,
} from "@/lib/db/env";

const developmentUrl =
  "postgresql://runtime:dev-secret@db.internal:5432/yu_inventory_dev";
const testUrl =
  "postgresql://runtime:test-secret@test-db.internal:5432/yu_inventory_test";
const productionUrl =
  "postgresql://runtime:prod-secret@prod-db.internal:5432/yu_inventory";
const developmentDeploymentId = "yu-inventory-development";
const testDeploymentId = "yu-inventory-test";
const productionDeploymentId = "yu-inventory-production";

describe("database environment configuration", () => {
  it.each(["development", "test", "production"] as const)(
    "maps NODE_ENV=%s to a database target",
    (target) => {
      expect(databaseTargetFromNodeEnv(target)).toBe(target);
      expect(parseDatabaseTarget(target)).toBe(target);
    },
  );

  it("requires an explicit, supported NODE_ENV", () => {
    expect(() => databaseTargetFromNodeEnv(undefined)).toThrow(
      DatabaseConfigurationError,
    );
    expect(() => databaseTargetFromNodeEnv("staging")).toThrow(
      /development, test, or production/,
    );
  });

  it("uses the test database only for the isolated production E2E build", () => {
    expect(
      applicationDatabaseTarget({
        NODE_ENV: "production",
        NEXT_DIST_DIR: ".next-e2e",
        YU_INVENTORY_E2E_DATABASE_TARGET: "test",
      }),
    ).toBe("test");
    expect(
      applicationDatabaseTarget({
        NODE_ENV: "production",
        YU_INVENTORY_E2E_DATABASE_TARGET: "test",
      }),
    ).toBe("production");
    expect(
      applicationDatabaseTarget({
        NODE_ENV: "development",
        NEXT_DIST_DIR: ".next-e2e",
        YU_INVENTORY_E2E_DATABASE_TARGET: "test",
      }),
    ).toBe("development");
  });

  it("shows safe command errors but suppresses raw driver messages", () => {
    expect(
      formatDatabaseCommandError(
        new DatabaseOperationError("Migration lock timed out."),
      ),
    ).toBe("Migration lock timed out.");
    expect(
      formatDatabaseCommandError(
        Object.assign(
          new Error(
            "failed for postgresql://runtime:do-not-print@db/internal",
          ),
          { code: "ECONNREFUSED" },
        ),
      ),
    ).toBe("Database command failed (code: ECONNREFUSED).");
  });

  it("requires exactly one explicit target for database commands", () => {
    expect(parseTargetArgument(["--target=test"])).toBe("test");
    expect(parseTargetArgument(["--target", "production"])).toBe(
      "production",
    );
    expect(() => parseTargetArgument([])).toThrow(/exactly one explicit/);
    expect(() =>
      parseTargetArgument(["--target=test", "--target=development"]),
    ).toThrow(/exactly one explicit/);
    expect(() => parseTargetArgument(["--target"])).toThrow(
      /requires a value/,
    );
    expect(() => parseTargetArgument(["--environment=test"])).toThrow(
      /Unsupported database command argument/,
    );
    const secretArgument =
      "--url=postgresql://runtime:do-not-print@db/yu_inventory";
    let message = "";

    try {
      parseTargetArgument([secretArgument]);
    } catch (error) {
      message = String(error);
    }

    expect(message).not.toContain("do-not-print");
  });

  it("builds bounded development defaults", () => {
    const config = readDatabaseConfig({
      env: {
        DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
        DATABASE_URL: developmentUrl,
      },
      target: "development",
    });

    expect(config).toMatchObject({
      applicationName: "yu-inventory-development-runtime",
      connectionTimeoutMs: 5_000,
      databaseName: "yu_inventory_dev",
      deploymentId: developmentDeploymentId,
      idleTimeoutMs: 30_000,
      poolMax: 5,
      runtimeUsername: "runtime",
      sslMode: "disable",
      statementTimeoutMs: 30_000,
    });
  });

  it("requires a safe logical deployment identity", () => {
    expect(() =>
      readDatabaseConfig({
        env: { DATABASE_URL: developmentUrl },
        target: "development",
      }),
    ).toThrow(/DATABASE_DEPLOYMENT_ID is required/);

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: "contains spaces",
          DATABASE_URL: developmentUrl,
        },
        target: "development",
      }),
    ).toThrow(/3-128 characters/);
  });

  it("uses independent test settings without falling back to DATABASE_URL", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_URL: developmentUrl,
        },
        target: "test",
      }),
    ).toThrow("TEST_DATABASE_URL is required");

    const config = readDatabaseConfig({
      env: {
        DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
        DATABASE_POOL_MAX: "19",
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_DEPLOYMENT_ID: testDeploymentId,
        TEST_DATABASE_POOL_MAX: "2",
        TEST_DATABASE_URL: testUrl,
      },
      target: "test",
    });

    expect(config.poolMax).toBe(2);
    expect(config.connectionString).toContain("test-db.internal");

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: testDeploymentId,
          DATABASE_URL: developmentUrl,
          TEST_DATABASE_DEPLOYMENT_ID: testDeploymentId,
          TEST_DATABASE_URL: testUrl,
        },
        target: "test",
      }),
    ).toThrow(/deployment IDs must be different/);
  });

  it("requires a distinct migrator role for database-backed tests", () => {
    const baseEnvironment = {
      TEST_DATABASE_DEPLOYMENT_ID: testDeploymentId,
      TEST_DATABASE_URL: testUrl,
    };

    expect(() =>
      readDatabaseConfig({
        env: baseEnvironment,
        purpose: "migration",
        target: "test",
      }),
    ).toThrow("TEST_DATABASE_MIGRATOR_URL is required");

    expect(() =>
      readDatabaseConfig({
        env: {
          ...baseEnvironment,
          TEST_DATABASE_MIGRATOR_URL: testUrl,
        },
        purpose: "migration",
        target: "test",
      }),
    ).toThrow(/different PostgreSQL role/);

    expect(
      readDatabaseConfig({
        env: {
          ...baseEnvironment,
          TEST_DATABASE_MIGRATOR_URL:
            "postgresql://migrator:test-secret@test-db.internal:5432/yu_inventory_test",
        },
        purpose: "migration",
        target: "test",
      }).purpose,
    ).toBe("migration");
  });

  it("requires a _test database for tests and forbids it elsewhere", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          TEST_DATABASE_DEPLOYMENT_ID: testDeploymentId,
          TEST_DATABASE_URL: developmentUrl,
        },
        target: "test",
      }),
    ).toThrow(/ending in _test/);

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_URL:
            "postgresql://runtime:secret@db.internal/yu_inventory_test",
        },
        target: "production",
      }),
    ).toThrow(/must not use.*_test/);
  });

  it("detects the same database through different users and default ports", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_URL: developmentUrl,
          TEST_DATABASE_DEPLOYMENT_ID: testDeploymentId,
          TEST_DATABASE_URL:
            "postgresql://another:secret@db.internal/yu_inventory_dev",
        },
        target: "development",
      }),
    ).toThrow(/must not point to the same database/);
  });

  it("requires a distinct production migration credential for the same database", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_URL: productionUrl,
        },
        purpose: "migration",
        target: "production",
      }),
    ).toThrow("DATABASE_MIGRATOR_URL is required");

    const config = readDatabaseConfig({
      env: {
        DATABASE_DEPLOYMENT_ID: productionDeploymentId,
        DATABASE_MIGRATOR_URL:
          "postgresql://migrator:migration-secret@prod-db.internal/yu_inventory",
        DATABASE_URL: productionUrl,
      },
      purpose: "migration",
      target: "production",
    });

    expect(config.applicationName).toBe(
      "yu-inventory-production-migration",
    );
    expect(config.connectionString).toContain("migrator");
    expect(config.sslMode).toBe("verify-full");

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_MIGRATOR_URL: productionUrl,
          DATABASE_URL: productionUrl,
        },
        purpose: "migration",
        target: "production",
      }),
    ).toThrow(/different PostgreSQL role/);
  });

  it("supports a direct migrator endpoint but rejects another database", () => {
    const directConfig = readDatabaseConfig({
      env: {
        DATABASE_DEPLOYMENT_ID: productionDeploymentId,
        DATABASE_MIGRATOR_URL:
          "postgresql://migrator:secret@direct.internal/yu_inventory",
        DATABASE_URL: productionUrl,
      },
      purpose: "migration",
      target: "production",
    });

    expect(directConfig.connectionString).toContain("direct.internal");
    expect(directConfig.runtimeConnectionString).toContain(
      "prod-db.internal",
    );

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_MIGRATOR_URL:
            "postgresql://migrator:secret@prod-db.internal/YU_INVENTORY",
          DATABASE_URL: productionUrl,
        },
        purpose: "migration",
        target: "production",
      }),
    ).toThrow(/same case-sensitive database name/);
  });

  it("centralizes TLS settings outside the URL", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_URL:
            "postgresql://runtime:super-secret@db.internal/yu_inventory_dev?sslmode=require",
        },
        target: "development",
      }),
    ).toThrow(/must not include query parameters/);

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_URL:
            "postgresql://runtime:secret@db.internal/yu_inventory_dev?options=-c%20search_path%3Devil",
        },
        target: "development",
      }),
    ).toThrow(/must not include query parameters/);

    for (const query of [
      "host=other.internal",
      "port=6543",
      "user=other",
      "statement_timeout=0",
      "query_timeout=0",
    ]) {
      expect(() =>
        readDatabaseConfig({
          env: {
            DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
            DATABASE_URL: `${developmentUrl}?${query}`,
          },
          target: "development",
        }),
      ).toThrow(/must not include query parameters/);
    }

    const verified = readDatabaseConfig({
      env: {
        DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
        DATABASE_SSL_CA: "private-ca",
        DATABASE_SSL_MODE: "verify-full",
        DATABASE_URL: developmentUrl,
      },
      target: "development",
    });

    expect(verified.sslCa).toBe("private-ca");
    expect(verified.sslMode).toBe("verify-full");
  });

  it("rejects a CA when certificate verification is disabled", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_SSL_CA: "private-ca",
          DATABASE_SSL_MODE: "require",
          DATABASE_URL: developmentUrl,
        },
        target: "development",
      }),
    ).toThrow(/SSL_CA can only be used with verify-full/);
  });

  it("requires an explicit production override for unverified TLS", () => {
    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_SSL_MODE: "require",
          DATABASE_URL: productionUrl,
        },
        target: "production",
      }),
    ).toThrow(/DATABASE_ALLOW_UNVERIFIED_TLS=true/);

    expect(
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_ALLOW_UNVERIFIED_TLS: "true",
          DATABASE_SSL_MODE: "require",
          DATABASE_URL: productionUrl,
        },
        target: "production",
      }).sslMode,
    ).toBe("require");

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: productionDeploymentId,
          DATABASE_ALLOW_UNVERIFIED_TLS: "true",
          DATABASE_SSL_MODE: "disable",
          DATABASE_URL: productionUrl,
        },
        target: "production",
      }),
    ).toThrow(/must use TLS/);
  });

  it("rejects malformed URLs and out-of-range tunables without leaking secrets", () => {
    const secret = "do-not-leak-this-password";
    let error: unknown;

    try {
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_POOL_MAX: "500",
          DATABASE_URL: `postgresql://runtime:${secret}@db.internal/yu_inventory_dev`,
        },
        target: "development",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DatabaseConfigurationError);
    expect(String(error)).not.toContain(secret);

    expect(() =>
      readDatabaseConfig({
        env: {
          DATABASE_DEPLOYMENT_ID: developmentDeploymentId,
          DATABASE_URL: "https://example.com/yu_inventory_dev",
        },
        target: "development",
      }),
    ).toThrow(/postgres or postgresql/);
  });
});
