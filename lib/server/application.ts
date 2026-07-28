import "server-only";

import { SettingsService } from "@/lib/application/services/settings-service";
import { FileSettingsRepository } from "@/lib/server/persistence/file/file-settings-repository";

export interface ApplicationServices {
  readonly settings: SettingsService;
}

const globalApplication = globalThis as typeof globalThis & {
  __yuInventoryApplication?: ApplicationServices;
};

export function getApplicationServices(): ApplicationServices {
  globalApplication.__yuInventoryApplication ??= {
    settings: new SettingsService(new FileSettingsRepository()),
  };
  return globalApplication.__yuInventoryApplication;
}
