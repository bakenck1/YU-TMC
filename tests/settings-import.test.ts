import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_APP_SETTINGS } from "../lib/app-settings";
import { DatabaseOperationError } from "../lib/db/env";
import {
  importLegacySettings,
  readLegacySettingsFile,
} from "../lib/db/settings-import";

test("legacy settings import leaves defaults when the source is missing", async () => {
  let connected = false;
  const result = await importLegacySettings(
    {
      async connect() {
        connected = true;
        throw new Error("must not connect for a missing source");
      },
    },
    {
      filename: "missing-settings.json",
      readFile: async () => {
        const error = Object.assign(new Error("missing"), { code: "ENOENT" });
        throw error;
      },
    },
  );

  assert.equal(result, "missing");
  assert.equal(connected, false);
});

test("legacy settings import fails closed before opening a transaction for corrupt JSON", async () => {
  await assert.rejects(
    readLegacySettingsFile("settings.json", async () => "{not-json"),
    (error: unknown) =>
      error instanceof DatabaseOperationError &&
      error.message.includes("not valid JSON"),
  );
});

test("legacy settings import is guarded and idempotent", async () => {
  const fake = createFakeDatabase();
  const source = {
    ...DEFAULT_APP_SETTINGS,
    organizationName: "Imported Inventory",
  };
  const options = {
    filename: "settings.json",
    readFile: async () => JSON.stringify(source),
  };

  await assert.doesNotReject(() => importLegacySettings(fake as never, options));
  assert.equal(fake.version, 2);
  assert.deepEqual(fake.payload, source);
  assert.equal(await importLegacySettings(fake as never, options), "skipped");
  assert.equal(fake.version, 2);
  assert.deepEqual(fake.payload, source);
  assert.deepEqual(fake.client.queries, [
    "begin",
    "select-for-update",
    "update",
    "commit",
    "begin",
    "select-for-update",
    "commit",
  ]);
});

test("legacy settings import refuses an invalid payload", async () => {
  const fake = createFakeDatabase();
  await assert.rejects(
    importLegacySettings(fake as never, {
      filename: "settings.json",
      readFile: async () => JSON.stringify({ language: "xx" }),
    }),
    (error: unknown) =>
      error instanceof DatabaseOperationError &&
      error.message.includes("valid AppSettings"),
  );
  assert.equal(fake.connected, false);
});

test("legacy settings import does not overwrite a version-one row with extra fields", async () => {
  const fake = createFakeDatabase({
    payload: { ...DEFAULT_APP_SETTINGS, futureFlag: true },
  });
  await assert.rejects(
    importLegacySettings(fake as never, {
      filename: "settings.json",
      readFile: async () =>
        JSON.stringify({
          ...DEFAULT_APP_SETTINGS,
          organizationName: "Must Not Replace",
        }),
    }),
    (error: unknown) =>
      error instanceof DatabaseOperationError &&
      error.message.includes("settings singleton row is invalid"),
  );
  assert.equal(fake.version, 1);
  assert.deepEqual(fake.client.queries, [
    "begin",
    "select-for-update",
    "rollback",
  ]);
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
        return {
          rows: [
            {
              id: "global",
              payload: state.payload,
              version: state.version,
            },
          ],
          rowCount: 1,
        };
      }
      if (query.startsWith("update ")) {
        client.queries.push("update");
        state.payload = values[1] as typeof state.payload;
        state.version += 1;
        return {
          rows: [
            {
              id: "global",
              payload: state.payload,
              version: state.version,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    release() {},
  };
  let connected = false;
  return {
    async connect() {
      connected = true;
      return client;
    },
    client,
    get connected() {
      return connected;
    },
    get payload() {
      return state.payload;
    },
    get version() {
      return state.version;
    },
  };
}
