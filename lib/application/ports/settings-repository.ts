import type { AppSettings } from "@/lib/app-settings";
import type { AppSettingsPatch } from "@/lib/domain/settings-policy";

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  update(patch: Readonly<AppSettingsPatch>): Promise<AppSettings>;
}
