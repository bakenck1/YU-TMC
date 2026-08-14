import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_APP_SETTINGS, type AppSettings } from "../lib/app-settings";
import { PostgresSettingsRepository } from "../lib/server/persistence/postgres/postgres-settings-repository";

test("PostgresSettingsRepository reads a cloned validated singleton", async () => {
  const fake = createFakeDatabase();
  const repository = new PostgresSettingsRepository({
    pool: () => fake.pool,
  });

  const settings = await repository.get();
  assert.deepEqual(settings, DEFAULT_APP_SETTINGS);
  settings.organizationName = "Mutated caller copy";
  assert.equal((await repository.get()).organizationName, "YU Inventory");
});

test("PostgresSettingsRepository updates under a row-locking transaction", async () => {
  const fake = createFakeDatabase();
  const repository = new PostgresSettingsRepository({
    pool: () => fake.pool,
  });

  await assert.doesNotReject(
    repository.update({ organizationName: "Updated Inventory" }),
  );
  assert.deepEqual(await repository.get(), {
    ...DEFAULT_APP_SETTINGS,
    organizationName: "Updated Inventory",
  });
  assert.deepEqual(fake.client.queries, [
    "begin",
    "select-for-update",
    "update",
    "commit",
  ]);
  assert.equal(fake.version, 2);
});

test("PostgresSettingsRepository rejects malformed stored payloads", async () => {
  const fake = createFakeDatabase({
    payload: { ...DEFAULT_APP_SETTINGS, language: "xx" } as unknown as AppSettings,
  });
  const repository = new PostgresSettingsRepository({
    pool: () => fake.pool,
  });

  await assert.rejects(repository.get(), { publicCode: "settings_unavailable" });
});

test("PostgresSettingsRepository exposes database failures as unavailable settings", async () => {
  const repository = new PostgresSettingsRepository({
    pool: () =>
      ({
        query: async () => {
          throw new Error("database connection failed");
        },
      }) as never,
  });

  await assert.rejects(repository.get(), { publicCode: "settings_unavailable" });
});

test("PostgresSettingsRepository wraps connection failures during updates", async () => {
  const repository = new PostgresSettingsRepository({
    pool: () =>
      ({
        connect: async () => {
          throw new Error("database connection failed");
        },
      }) as never,
  });

  await assert.rejects(
    repository.update({ organizationName: "Unavailable Inventory" }),
    { publicCode: "settings_unavailable" },
  );
});

test("PostgresSettingsRepository rolls back when a direct invalid patch is supplied", async () => {
  const fake = createFakeDatabase();
  const repository = new PostgresSettingsRepository({
    pool: () => fake.pool,
  });

  await assert.rejects(
    repository.update({ language: "xx" } as never),
    { publicCode: "settings_unavailable" },
  );
  assert.deepEqual(fake.client.queries, ["begin", "select-for-update", "rollback"]);
  assert.equal(fake.version, 1);
});

function createFakeDatabase(
  overrides: Partial<{ payload: unknown; version: number }> = {},
) {
  const state: { payload: unknown; version: number } = {
    payload: overrides.payload ?? { ...DEFAULT_APP_SETTINGS },
    version: overrides.version ?? 1,
  };
  const client = {
    queries: [] as string[],
    async query(query: string, values: unknown[] = []) {
      if (query === "begin" || query === "commit" || query === "rollback") {
        client.queries.push(query);
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("for update")) {
        client.queries.push("select-for-update");
        return { rows: [row(state.payload, state.version)], rowCount: 1 };
      }
      if (query.startsWith("update ")) {
        client.queries.push("update");
        state.payload = values[1] as unknown;
        state.version += 1;
        return { rows: [row(state.payload, state.version)], rowCount: 1 };
      }
      throw new Error(`Unexpected client query: ${query}`);
    },
    release() {},
  };
  const pool = {
    async query(query: string) {
      if (!query.includes("from \"yu_inventory\".\"settings\"")) {
        throw new Error(`Unexpected pool query: ${query}`);
      }
      return { rows: [row(state.payload, state.version)], rowCount: 1 };
    },
    async connect() {
      return client;
    },
  } as never;

  return {
    pool,
    client,
    get payload() {
      return state.payload;
    },
    get version() {
      return state.version;
    },
  };
}

function row(payload: unknown, version: number) {
  return {
    id: "global",
    payload,
    version,
    updated_at: new Date("2026-08-14T00:00:00.000Z"),
  };
}
