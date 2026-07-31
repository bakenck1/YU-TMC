import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { InventoryLocationService } from "@/lib/application/services/inventory-location-service";
import { InventoryItemService } from "@/lib/application/services/inventory-item-service";
import { QrResolutionService } from "@/lib/application/services/qr-resolution-service";
import { InventoryResponsibilityService } from "@/lib/application/services/inventory-responsibility-service";
import { InventoryInspectionService } from "@/lib/application/services/inventory-inspection-service";
import { WebPushService } from "@/lib/application/services/web-push-service";
import { SettingsService } from "@/lib/application/services/settings-service";
import { UserService } from "@/lib/application/services/user-service";
import { FileSettingsRepository } from "@/lib/server/persistence/file/file-settings-repository";
import { MemoryUserUnitOfWork } from "@/lib/server/persistence/memory/memory-user-unit-of-work";
import { createPostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { createPostgresInventoryLocationRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-location-repositories";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { createPostgresQrResolutionRepositories } from "@/lib/server/persistence/postgres/postgres-qr-resolution-repositories";
import { createPostgresInventoryResponsibilityRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-responsibility-repositories";
import { createPostgresInventoryInspectionRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-inspection-repositories";
import { createPostgresWebPushRepositories } from "@/lib/server/persistence/postgres/postgres-web-push-repositories";
import { createPostgresUserRepositories } from "@/lib/server/persistence/postgres/postgres-user-repositories";
import { ScryptPasswordHasher } from "@/lib/server/security/scrypt-password-hasher";
import {
  NodeWebPushSender,
  readWebPushConfiguration,
} from "@/lib/server/web-push-sender";

export interface ApplicationServices {
  readonly items: InventoryItemService;
  readonly locations: InventoryLocationService;
  readonly qr: QrResolutionService;
  readonly responsibility: InventoryResponsibilityService;
  readonly inspections: InventoryInspectionService;
  readonly push: WebPushService;
  readonly settings: SettingsService;
  readonly users: UserService;
}

const globalApplication = globalThis as typeof globalThis & {
  __yuInventoryApplication?: ApplicationServices;
  __yuInventoryMemoryUsers?: MemoryUserUnitOfWork;
};

export function getApplicationServices(): ApplicationServices {
  // Next.js keeps global values through hot reloads. Recreate the development
  // container so a newly added service method is available immediately.
  if (process.env.NODE_ENV === "development") {
    return createApplicationServices();
  }
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

  const push = new WebPushService(
    createPostgresUnitOfWork(createPostgresWebPushRepositories),
    new NodeWebPushSender(),
    readWebPushConfiguration(),
    { now: () => new Date() },
    { create: () => randomUUID() },
  );

  return {
    items: new InventoryItemService(
      createPostgresUnitOfWork(createPostgresInventoryItemRepositories),
      { now: () => new Date() },
      { create: () => randomUUID() },
      { create: () => randomBytes(16) },
      {
        next: (year) =>
          `TMP-${year}-${String(Date.now() % 1_000_000).padStart(6, "0")}`,
      },
    ),
    locations: new InventoryLocationService(
      createPostgresUnitOfWork(createPostgresInventoryLocationRepositories),
      { now: () => new Date() },
      { create: () => randomUUID() },
      { create: () => randomBytes(16) },
    ),
    qr: new QrResolutionService(
      createPostgresUnitOfWork(createPostgresQrResolutionRepositories),
    ),
    responsibility: new InventoryResponsibilityService(
      createPostgresUnitOfWork(
        createPostgresInventoryResponsibilityRepositories,
      ),
      { now: () => new Date() },
      { create: () => randomUUID() },
    ),
    inspections: new InventoryInspectionService(
      createPostgresUnitOfWork(createPostgresInventoryInspectionRepositories),
      { now: () => new Date() },
      { create: () => randomUUID() },
    ),
    push,
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
