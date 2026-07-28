import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { ApplicationError } from "@/lib/domain/application-error";
import { FileSettingsRepository } from "@/lib/server/persistence/file/file-settings-repository";

const directories: string[] = [];

function createDirectory() {
  const directory = path.join(
    tmpdir(),
    `yu-inventory-settings-${randomUUID()}`,
  );
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("FileSettingsRepository", () => {
  it("creates defaults only when the settings file is missing", async () => {
    const directory = createDirectory();
    const repository = new FileSettingsRepository({ directory: () => directory });

    await expect(repository.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    await expect(
      readFile(path.join(directory, "settings.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("reports corrupt JSON without replacing it", async () => {
    const directory = createDirectory();
    const filename = path.join(directory, "settings.json");
    await mkdir(directory, { recursive: true });
    await writeFile(filename, "{not-json", "utf8");
    const repository = new FileSettingsRepository({ directory: () => directory });

    await expect(repository.get()).rejects.toMatchObject({
      kind: "unavailable",
      publicCode: "settings_unavailable",
    } satisfies Partial<ApplicationError>);
    await expect(readFile(filename, "utf8")).resolves.toBe("{not-json");
  });

  it("reports an invalid document shape without resetting user data", async () => {
    const directory = createDirectory();
    const filename = path.join(directory, "settings.json");
    await mkdir(directory, { recursive: true });
    await writeFile(filename, JSON.stringify({ language: "kk" }), "utf8");
    const repository = new FileSettingsRepository({ directory: () => directory });

    await expect(repository.get()).rejects.toBeInstanceOf(ApplicationError);
    await expect(readFile(filename, "utf8")).resolves.toBe(
      JSON.stringify({ language: "kk" }),
    );
  });

  it("serializes concurrent patches so neither update is lost", async () => {
    const directory = createDirectory();
    const repository = new FileSettingsRepository({ directory: () => directory });
    await repository.get();

    await Promise.all([
      repository.update({ language: "en" }),
      repository.update({ pushNotifications: true }),
    ]);

    await expect(repository.get()).resolves.toMatchObject({
      language: "en",
      pushNotifications: true,
    });
  });

  it("shares the per-file lock across repository instances", async () => {
    const directory = createDirectory();
    const firstRepository = new FileSettingsRepository({
      directory: () => directory,
    });
    const secondRepository = new FileSettingsRepository({
      directory: () => path.join(directory, "."),
    });
    await firstRepository.get();

    await Promise.all([
      firstRepository.update({ language: "en" }),
      secondRepository.update({ maintenanceAlerts: false }),
    ]);

    await expect(firstRepository.get()).resolves.toMatchObject({
      language: "en",
      maintenanceAlerts: false,
    });
  });

  it("returns copies instead of mutable shared state", async () => {
    const directory = createDirectory();
    const repository = new FileSettingsRepository({ directory: () => directory });
    const first = await repository.get();
    first.organizationName = "Mutated outside repository";

    await expect(repository.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("projects persisted data onto the public settings contract", async () => {
    const directory = createDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, internalSecret: "hidden" }),
      "utf8",
    );
    const repository = new FileSettingsRepository({ directory: () => directory });

    await expect(repository.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("keeps the previous file if atomic replacement fails", async () => {
    const directory = createDirectory();
    const filename = path.join(directory, "settings.json");
    const workingRepository = new FileSettingsRepository({
      directory: () => directory,
    });
    await workingRepository.get();
    const original = await readFile(filename, "utf8");

    const failingRepository = new FileSettingsRepository({
      directory: () => directory,
      fileSystem: {
        mkdir: (target) => mkdir(target, { recursive: true }),
        readFile: (target) => readFile(target, "utf8"),
        rename: async () => {
          throw Object.assign(new Error("simulated rename failure"), {
            code: "EIO",
          });
        },
        rm: (target) => rm(target, { force: true }),
        writeFile: (target, contents, options) =>
          writeFile(target, contents, { encoding: "utf8", ...options }),
      },
    });

    await expect(
      failingRepository.update({ language: "ru" }),
    ).rejects.toMatchObject({ publicCode: "settings_unavailable" });
    await expect(readFile(filename, "utf8")).resolves.toBe(original);
    await expect(readdir(directory)).resolves.toEqual(["settings.json"]);
  });
});
