import "server-only";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  isAppSettings,
  type AppSettings,
} from "@/lib/app-settings";
import type { SettingsRepository } from "@/lib/application/ports/settings-repository";
import { ApplicationError } from "@/lib/domain/application-error";
import type { AppSettingsPatch } from "@/lib/domain/settings-policy";
import { getDatabasePool } from "@/lib/db/client";

const SETTINGS_TABLE = '"yu_inventory"."settings"';
const SETTINGS_ID = "global";

interface SettingsRow extends QueryResultRow {
  id: string;
  payload: unknown;
  version: number;
  updated_at: Date;
}

export interface PostgresSettingsRepositoryOptions {
  pool?: () => Pool;
}

/**
 * PostgreSQL-backed application settings. The update transaction owns the row
 * lock so two application instances cannot read the same version and then
 * silently overwrite one another.
 */
export class PostgresSettingsRepository implements SettingsRepository {
  private readonly pool: () => Pool;

  constructor(options: PostgresSettingsRepositoryOptions = {}) {
    this.pool = options.pool ?? getDatabasePool;
  }

  async get(): Promise<AppSettings> {
    try {
      const result = await this.pool().query<SettingsRow>(
        `select id, payload, version, updated_at
           from ${SETTINGS_TABLE}
          where id = $1`,
        [SETTINGS_ID],
      );
      return mapSettingsRow(result.rows[0]);
    } catch (error) {
      throw normalizeSettingsError(error);
    }
  }

  async update(patch: Readonly<AppSettingsPatch>): Promise<AppSettings> {
    let client: PoolClient | undefined;
    let transactionStarted = false;

    try {
      client = await this.pool().connect();
      const activeClient = client;
      await activeClient.query("begin");
      transactionStarted = true;

      const currentResult = await activeClient.query<SettingsRow>(
        `select id, payload, version, updated_at
           from ${SETTINGS_TABLE}
          where id = $1
          for update`,
        [SETTINGS_ID],
      );
      const current = mapSettingsRow(currentResult.rows[0]);
      const next: AppSettings = { ...current, ...patch };
      if (!isAppSettings(next)) {
        throw unavailableSettingsError(
          new Error("Settings patch produced an invalid application payload."),
        );
      }

      const updatedResult = await activeClient.query<SettingsRow>(
        `update ${SETTINGS_TABLE}
            set payload = $2::jsonb,
                version = version + 1,
                updated_at = transaction_timestamp()
          where id = $1
          returning id, payload, version, updated_at`,
        [SETTINGS_ID, next],
      );
      const updated = mapSettingsRow(updatedResult.rows[0]);

      await activeClient.query("commit");
      transactionStarted = false;
      return updated;
    } catch (error) {
      if (transactionStarted && client) {
        await client.query("rollback").catch(() => undefined);
      }
      throw normalizeSettingsError(error);
    } finally {
      client?.release();
    }
  }
}

function mapSettingsRow(row: SettingsRow | undefined): AppSettings {
  if (!row || row.id !== SETTINGS_ID || !isPositiveVersion(row.version)) {
    throw unavailableSettingsError(
      new Error("The settings singleton row is missing or invalid."),
    );
  }

  const payload = parsePayload(row.payload);
  if (!isAppSettings(payload)) {
    throw unavailableSettingsError(
      new Error("The settings singleton payload is invalid."),
    );
  }

  return cloneSettings(payload);
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
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

function isPositiveVersion(version: unknown): version is number {
  return typeof version === "number" && Number.isInteger(version) && version > 0;
}

function unavailableSettingsError(cause: unknown) {
  return new ApplicationError("unavailable", "settings_unavailable", {
    cause,
    message: "Application settings are unavailable.",
  });
}

function normalizeSettingsError(error: unknown) {
  if (error instanceof ApplicationError && error.publicCode === "settings_unavailable") {
    return error;
  }
  return unavailableSettingsError(error);
}
