import "server-only";

import { randomUUID } from "node:crypto";

import { SettingsService } from "@/lib/application/services/settings-service";
import { UserService } from "@/lib/application/services/user-service";
import { FileSettingsRepository } from "@/lib/server/persistence/file/file-settings-repository";
import { MemoryUserUnitOfWork } from "@/lib/server/persistence/memory/memory-user-unit-of-work";
import { createPostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { createPostgresUserRepositories } from "@/lib/server/persistence/postgres/postgres-user-repositories";
import { ScryptPasswordHasher } from "@/lib/server/security/scrypt-password-hasher";

export interface ApplicationServices {
  readonly settings: SettingsService;
  readonly users: UserService;
}

const globalApplication = globalThis as typeof globalThis & {
  __yuInventoryApplication?: ApplicationServices;
  __yuInventoryMemoryUsers?: MemoryUserUnitOfWork;
};

export function getApplicationServices(): ApplicationServices {
  globalApplication.__yuInventoryApplication ??= createApplicationServices();
  return globalApplication.__yuInventoryApplication;
}

export function resetApplicationServicesForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Application services can only be reset in tests.");
  }
  globalApplication.__yuInventoryApplication = undefined;
  globalApplication.__yuInventoryMemoryUsers?.reset();
  globalApplication.__yuInventoryMemoryUsers = undefined;
}

function createApplicationServices(): ApplicationServices {
  const userUnitOfWork = shouldUseMemoryUsers()
    ? (globalApplication.__yuInventoryMemoryUsers ??=
        new MemoryUserUnitOfWork())
    : createPostgresUnitOfWork(createPostgresUserRepositories);

  return {
    settings: new SettingsService(new FileSettingsRepository()),
    users: new UserService(
      userUnitOfWork,
      new ScryptPasswordHasher(),
      { now: () => new Date() },
      { create: () => randomUUID() },
    ),
  };
}

function shouldUseMemoryUsers(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.YU_INVENTORY_TEST_USER_STORE === "memory"
  );
}
