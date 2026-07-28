import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  readLocalMigrationManifest,
  validateMigrationState,
  type AppliedMigration,
  type MigrationManifestEntry,
} from "@/lib/db/migration-manifest";

const local: MigrationManifestEntry[] = [
  { createdAt: 1_000, hash: "hash-one" },
  { createdAt: 2_000, hash: "hash-two" },
];

describe("database migration history", () => {
  it("keeps committed migration bytes and hashes platform-independent", () => {
    const migrationDirectory = path.resolve(process.cwd(), "drizzle");
    const migrationFiles = fs
      .readdirSync(migrationDirectory)
      .filter((fileName) => fileName.endsWith(".sql"));

    expect(migrationFiles.length).toBeGreaterThan(0);

    for (const fileName of migrationFiles) {
      const contents = fs.readFileSync(
        path.join(migrationDirectory, fileName),
        "utf8",
      );
      expect(contents).not.toContain("\r");
    }

    expect(readLocalMigrationManifest().fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts an exact history and a valid applied prefix", () => {
    expect(() =>
      validateMigrationState(local, local, { allowPending: false }),
    ).not.toThrow();
    expect(() =>
      validateMigrationState(local, [local[0]], { allowPending: true }),
    ).not.toThrow();
  });

  it("rejects pending migrations when a current schema is required", () => {
    expect(() =>
      validateMigrationState(local, [local[0]], { allowPending: false }),
    ).toThrow(/unapplied committed migrations/);
  });

  it("rejects changed SQL hashes, gaps, and unknown applied entries", () => {
    expect(() =>
      validateMigrationState(
        local,
        [{ createdAt: 1_000, hash: "changed" }],
        { allowPending: true },
      ),
    ).toThrow(/history has drifted/);

    expect(() =>
      validateMigrationState(local, [local[1]], { allowPending: true }),
    ).toThrow(/history has drifted/);

    const unknown: AppliedMigration[] = [
      ...local,
      { createdAt: 3_000, hash: "unknown" },
    ];
    expect(() =>
      validateMigrationState(local, unknown, { allowPending: true }),
    ).toThrow(/not present in this release/);
  });

  it("rejects duplicate or out-of-order timestamps", () => {
    expect(() =>
      validateMigrationState(
        [
          local[0],
          { createdAt: local[0].createdAt, hash: "duplicate" },
        ],
        [],
        { allowPending: true },
      ),
    ).toThrow(/unique and strictly increasing/);

    expect(() =>
      validateMigrationState(
        [
          local[1],
          local[0],
        ],
        [],
        { allowPending: true },
      ),
    ).toThrow(/unique and strictly increasing/);
  });
});
