import type { AppSettings } from "@/lib/app-settings";
import type { SettingsRepository } from "@/lib/application/ports/settings-repository";
import { parseAppSettingsPatch } from "@/lib/domain/settings-policy";

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  get(): Promise<AppSettings> {
    return this.repository.get();
  }

  async update(input: unknown): Promise<AppSettings> {
    const patch = parseAppSettingsPatch(input);
    if (Object.keys(patch).length === 0) {
      return this.repository.get();
    }
    return this.repository.update(patch);
  }
}
