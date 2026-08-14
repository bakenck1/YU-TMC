import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  DEFAULT_APP_SETTINGS,
  isAppSettings,
  type AppSettings,
} from "@/lib/app-settings";
import { DatabaseOperationError } from "@/lib/db/env";
import { dataDirectory } from "@/lib/data-directory";

const SETTINGS_TABLE = '"yu_inventory"."settings"';
const SETTINGS_ID = "global";

export type SettingsImportOutcome = "missing" | "imported" | "skipped";

export interface SettingsImportOptions {
  filename?: string;
  readFile?: (filename: string) => Promise<string>;
}

export interface SettingsDatabase {
  connect(): Promise<PoolClient>;
}

interface SettingsRow extends QueryResultRow {
  id: string;
  payload: unknown;
  version: number;
}

/**
 * Imports the pre-PostgreSQL settings document exactly once. The singleton is
 * locked before the guard is evaluated, so concurrent release jobs cannot both
 * import different file contents.
 */
export async function importLegacySettings(
  database: SettingsDatabase | Pool,
  options: SettingsImportOptions = {},
): Promise<SettingsImportOutcome> {
  const filename =
    options.filename ?? path.resolve(dataDirectory(), "settings.json");
  const settings = await readLegacySettingsFile(filename, options.readFile);
  if (!settings) return "missing";

  const client = await database.connect();
  let transactionStarted = false;

  try {
    await client.query("begin");
    transactionStarted = true;

    const currentResult = await client.query<SettingsRow>(
      `select id, payload, version
         from ${SETTINGS_TABLE}
        where id = $1
        for update`,
      [SETTINGS_ID],
    );
    const current = currentResult.rows[0];
    if (!current || current.id !== SETTINGS_ID) {
      throw new DatabaseOperationError(
        "The settings singleton row is missing; apply migrations before importing settings.",
      );
    }

    const currentPayload = parseStoredPayload(current.payload);
    if (
      !isAppSettings(currentPayload) ||
      !Number.isInteger(current.version) ||
      current.version < 1
    ) {
      throw new DatabaseOperationError(
        "The settings singleton row is invalid; refusing to import legacy settings.",
      );
    }

    if (current.version !== 1 || !sameSettings(currentPayload, DEFAULT_APP_SETTINGS)) {
      await client.query("commit");
      transactionStarted = false;
      return "skipped";
    }

    const updatedResult = await client.query<SettingsRow>(
      `update ${SETTINGS_TABLE}
          set payload = $2::jsonb,
              version = version + 1,
              updated_at = transaction_timestamp()
        where id = $1
          and version = 1
        returning id, payload, version`,
      [SETTINGS_ID, settings],
    );
    if (updatedResult.rowCount !== 1) {
      throw new DatabaseOperationError(
        "The settings singleton changed during import; no legacy data was written.",
      );
    }

    await client.query("commit");
    transactionStarted = false;
    return "imported";
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function readLegacySettingsFile(
  filename: string,
  readSettingsFile: (filename: string) => Promise<string> = (target) =>
    readFile(target, "utf8"),
): Promise<AppSettings | null> {
  let contents: string;
  try {
    contents = await readSettingsFile(filename);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw new DatabaseOperationError(
      `Could not read legacy settings source ${filename}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new DatabaseOperationError(
      `Legacy settings source ${filename} is not valid JSON.`,
    );
  }

  if (!isAppSettings(parsed)) {
    throw new DatabaseOperationError(
      `Legacy settings source ${filename} does not contain a valid AppSettings payload.`,
    );
  }
  return cloneSettings(parsed);
}

function parseStoredPayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
  return (
    left.organizationName === right.organizationName &&
    left.language === right.language &&
    left.emailNotifications === right.emailNotifications &&
    left.pushNotifications === right.pushNotifications &&
    left.maintenanceAlerts === right.maintenanceAlerts
  );
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    organizationName: settings.organizationName,
    language: settings.language,
    emailNotifications: settings.emailNotifications,
    pushNotifications: settings.pushNotifications,
    maintenanceAlerts: settings.maintenanceAlerts,
  };
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}
