import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@/lib/app-settings";
import type { SettingsRepository } from "@/lib/application/ports/settings-repository";
import { SettingsService } from "@/lib/application/services/settings-service";
import { ApplicationError } from "@/lib/domain/application-error";

function createRepository() {
  let settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  const repository: SettingsRepository = {
    get: vi.fn(async () => ({ ...settings })),
    update: vi.fn(async (patch) => {
      settings = { ...settings, ...patch };
      return { ...settings };
    }),
  };
  return repository;
}

async function expectValidationCode(
  service: SettingsService,
  input: unknown,
  code: string,
) {
  await expect(service.update(input)).rejects.toMatchObject({
    kind: "validation",
    publicCode: code,
  } satisfies Partial<ApplicationError>);
}

describe("SettingsService", () => {
  it("normalizes a valid allowlisted patch", async () => {
    const repository = createRepository();
    const service = new SettingsService(repository);

    await expect(
      service.update({
        organizationName: "  Yessenov University  ",
        language: "en",
        pushNotifications: true,
      }),
    ).resolves.toMatchObject({
      organizationName: "Yessenov University",
      language: "en",
      pushNotifications: true,
    });
    expect(repository.update).toHaveBeenCalledWith({
      organizationName: "Yessenov University",
      language: "en",
      pushNotifications: true,
    });
  });

  it.each([null, [], "settings", 7])(
    "rejects a non-object payload: %j",
    async (input) => {
      await expectValidationCode(
        new SettingsService(createRepository()),
        input,
        "invalid_settings_payload",
      );
    },
  );

  it("rejects unknown and prototype-sensitive keys", async () => {
    const service = new SettingsService(createRepository());
    await expectValidationCode(
      service,
      { language: "kk", unexpected: true },
      "invalid_settings_payload",
    );
    await expectValidationCode(
      service,
      JSON.parse('{"__proto__":{"admin":true}}'),
      "invalid_settings_payload",
    );
  });

  it.each(["", " ", "a", "a".repeat(81), false])(
    "rejects an invalid organization name: %j",
    async (organizationName) => {
      await expectValidationCode(
        new SettingsService(createRepository()),
        { organizationName },
        "invalid_organization_name",
      );
    },
  );

  it.each(["de", "", null, 1])(
    "rejects an unsupported language: %j",
    async (language) => {
      await expectValidationCode(
        new SettingsService(createRepository()),
        { language },
        "invalid_language",
      );
    },
  );

  it.each(["true", 1, null, undefined])(
    "rejects a non-boolean notification value: %j",
    async (emailNotifications) => {
      await expectValidationCode(
        new SettingsService(createRepository()),
        { emailNotifications },
        "invalid_notification_setting",
      );
    },
  );

  it("does not call update for an empty patch", async () => {
    const repository = createRepository();
    const service = new SettingsService(repository);

    await expect(service.update({})).resolves.toEqual(DEFAULT_APP_SETTINGS);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.get).toHaveBeenCalledOnce();
  });

  it("validates before touching persistence", async () => {
    const repository = createRepository();
    const service = new SettingsService(repository);

    await expectValidationCode(
      service,
      { language: "unsupported" },
      "invalid_language",
    );
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
