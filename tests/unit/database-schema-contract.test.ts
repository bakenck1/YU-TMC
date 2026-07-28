import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { readDatabaseConfig } from "@/lib/db/env";
import type { MigrationManifest } from "@/lib/db/migration-manifest";
import { assertSchemaContract } from "@/lib/db/schema-contract";

const config = readDatabaseConfig({
  env: {
    DATABASE_DEPLOYMENT_ID: "yu-inventory-contract-test",
    DATABASE_URL:
      "postgresql://runtime:secret@db.internal/yu_inventory_dev",
  },
  target: "development",
});
const manifest: MigrationManifest = {
  entries: [],
  fingerprint: "a".repeat(64),
};

describe("database schema contract", () => {
  it("rejects a missing contract when a current schema is required", async () => {
    const database = createQueryMock([{ exists: false }]);

    await expect(
      assertSchemaContract(database, config, manifest, {
        allowMissing: false,
        allowStale: false,
      }),
    ).rejects.toThrow(/schema contract is missing/);
  });

  it("rejects the wrong deployment identity or manifest hash", async () => {
    const wrongDeployment = createQueryMock(
      [{ exists: true }],
      [
        {
          deployment_id: "another-deployment",
          manifest_hash: manifest.fingerprint,
        },
      ],
    );

    await expect(
      assertSchemaContract(wrongDeployment, config, manifest, {
        allowMissing: false,
        allowStale: false,
      }),
    ).rejects.toThrow(/deployment identity/);

    const staleManifest = createQueryMock(
      [{ exists: true }],
      [{ deployment_id: config.deploymentId, manifest_hash: "b".repeat(64) }],
    );

    await expect(
      assertSchemaContract(staleManifest, config, manifest, {
        allowMissing: false,
        allowStale: false,
      }),
    ).rejects.toThrow(/migration manifest/);
  });

  it("accepts the exact runtime-visible contract", async () => {
    const database = createQueryMock(
      [{ exists: true }],
      [
        {
          deployment_id: config.deploymentId,
          manifest_hash: manifest.fingerprint,
        },
      ],
    );

    await expect(
      assertSchemaContract(database, config, manifest, {
        allowMissing: false,
        allowStale: false,
      }),
    ).resolves.toBeUndefined();
  });
});

function createQueryMock(...resultRows: unknown[][]): Pool {
  const query = vi.fn();

  for (const rows of resultRows) {
    query.mockResolvedValueOnce({ rows });
  }

  return { query } as unknown as Pool;
}
