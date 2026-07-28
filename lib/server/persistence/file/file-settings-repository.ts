import "server-only";

import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_APP_SETTINGS,
  isAppSettings,
  type AppSettings,
} from "@/lib/app-settings";
import type { SettingsRepository } from "@/lib/application/ports/settings-repository";
import { dataDirectory } from "@/lib/data-directory";
import { ApplicationError } from "@/lib/domain/application-error";
import type { AppSettingsPatch } from "@/lib/domain/settings-policy";

interface SettingsFileSystem {
  mkdir(directory: string): Promise<unknown>;
  readFile(filename: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  rm(filename: string): Promise<void>;
  writeFile(
    filename: string,
    contents: string,
    options: { flag?: "wx"; mode?: number },
  ): Promise<void>;
}

const nodeFileSystem: SettingsFileSystem = {
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  readFile: (filename) => readFile(filename, "utf8"),
  rename,
  rm: (filename) => rm(filename, { force: true }),
  writeFile: (filename, contents, options) =>
    writeFile(filename, contents, {
      encoding: "utf8",
      ...options,
    }),
};

const globalSettingsLocks = globalThis as typeof globalThis & {
  __yuInventorySettingsFileLocks?: Map<string, Promise<void>>;
};

function settingsFileLocks() {
  globalSettingsLocks.__yuInventorySettingsFileLocks ??= new Map();
  return globalSettingsLocks.__yuInventorySettingsFileLocks;
}

export interface FileSettingsRepositoryOptions {
  directory?: () => string;
  fileSystem?: SettingsFileSystem;
}

export class FileSettingsRepository implements SettingsRepository {
  private readonly directory: () => string;
  private readonly fileSystem: SettingsFileSystem;

  constructor(options: FileSettingsRepositoryOptions = {}) {
    this.directory = options.directory ?? dataDirectory;
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
  }

  get(): Promise<AppSettings> {
    return this.runExclusive(async (filename) =>
      cloneSettings(await this.readOrCreate(filename)),
    );
  }

  update(patch: Readonly<AppSettingsPatch>): Promise<AppSettings> {
    return this.runExclusive(async (filename) => {
      const current = await this.readOrCreate(filename);
      const next: AppSettings = { ...current, ...patch };
      await this.writeAtomically(filename, next);
      return cloneSettings(next);
    });
  }

  private runExclusive<Result>(
    operation: (filename: string) => Promise<Result>,
  ): Promise<Result> {
    const filename = this.settingsFilename();
    const locks = settingsFileLocks();
    const previous = locks.get(filename) ?? Promise.resolve();
    const result = previous.then(
      () => operation(filename),
      () => operation(filename),
    );
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    locks.set(filename, tail);
    void tail.then(() => {
      if (locks.get(filename) === tail) locks.delete(filename);
    });
    return result;
  }

  private async readOrCreate(filename: string): Promise<AppSettings> {
    try {
      return await this.readExisting(filename);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }

    try {
      await this.fileSystem.mkdir(path.dirname(filename));
      await this.fileSystem.writeFile(
        filename,
        serializeSettings(DEFAULT_APP_SETTINGS),
        { flag: "wx", mode: 0o600 },
      );
      return cloneSettings(DEFAULT_APP_SETTINGS);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        return this.readExisting(filename);
      }
      throw unavailableSettingsError(error);
    }
  }

  private async readExisting(filename: string): Promise<AppSettings> {
    let contents: string;
    try {
      contents = await this.fileSystem.readFile(filename);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) throw error;
      throw unavailableSettingsError(error);
    }

    try {
      const parsed: unknown = JSON.parse(contents);
      if (!isAppSettings(parsed)) throw new Error("Invalid settings shape");
      return cloneSettings(parsed);
    } catch (error) {
      throw unavailableSettingsError(error);
    }
  }

  private async writeAtomically(
    filename: string,
    settings: AppSettings,
  ): Promise<void> {
    const directory = path.dirname(filename);
    const temporaryFilename = path.join(
      directory,
      `.settings-${randomUUID()}.tmp`,
    );

    try {
      await this.fileSystem.mkdir(directory);
      await this.fileSystem.writeFile(
        temporaryFilename,
        serializeSettings(settings),
        { flag: "wx", mode: 0o600 },
      );
      await this.fileSystem.rename(temporaryFilename, filename);
    } catch (error) {
      throw unavailableSettingsError(error);
    } finally {
      await this.fileSystem.rm(temporaryFilename).catch(() => undefined);
    }
  }

  private settingsFilename() {
    return path.resolve(this.directory(), "settings.json");
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

function serializeSettings(settings: AppSettings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function unavailableSettingsError(cause: unknown) {
  return new ApplicationError("unavailable", "settings_unavailable", {
    cause,
    message: "Application settings are unavailable.",
  });
}

function hasErrorCode(error: unknown, expectedCode: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === expectedCode
  );
}
