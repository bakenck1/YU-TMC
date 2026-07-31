import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_APP_SETTINGS, isAppLanguage } from "../lib/app-settings";
import {
  dictionaries,
  translate,
  translateCampusBuilding,
  translateCampusBuildingDescription,
} from "../lib/i18n";

const ROOT = new URL("../", import.meta.url);

test("Russian is primary and all three interface languages are accepted", () => {
  assert.equal(DEFAULT_APP_SETTINGS.language, "ru");
  assert.equal(isAppLanguage("ru"), true);
  assert.equal(isAppLanguage("kk"), true);
  assert.equal(isAppLanguage("en"), true);
  assert.equal(isAppLanguage("de"), false);
});

test("critical interface and push messages have distinct RU, KK and EN translations", () => {
  const keys = [
    "nav.items",
    "settings.interfaceLanguage",
    "inspections.title",
    "scanner.roomTitle",
    "itemDetails.protectedFields",
    "push.assignmentTitle",
  ] as const;

  for (const key of keys) {
    const values = (["ru", "kk", "en"] as const).map((language) =>
      translate(language, key),
    );
    assert.equal(new Set(values).size, 3, `${key} must be translated in all languages`);
  }

  assert.equal(
    translate("en", "push.assignmentBody", { name: "July check" }),
    "“July check” has been assigned to you",
  );
});

test("the English dictionary never falls back to Cyrillic Russian copy", () => {
  for (const [key, value] of Object.entries(dictionaries.en)) {
    assert.doesNotMatch(value, /[А-Яа-яЁё]/u, `${key} is not translated to English`);
  }
});

test("known campus building names follow the selected interface language", () => {
  assert.equal(translateCampusBuilding("ru", "The Main Campus"), "Главный кампус");
  assert.equal(translateCampusBuilding("kk", "The Main Campus"), "Бас кампус");
  assert.equal(translateCampusBuilding("en", "Главный корпус"), "The Main Campus");
  assert.equal(
    translateCampusBuildingDescription("en", "Главный корпус", "fallback"),
    "Academic and administrative building",
  );
  assert.equal(
    translateCampusBuildingDescription("kk", "Технопарк", "fallback"),
    "Зертханалар мен шеберханалар",
  );
});

test("localized inventory controls contain no hard-coded Cyrillic UI copy", async () => {
  const files = [
    "components/InventoryBuildingsManager.tsx",
    "components/InventoryInspectionsManager.tsx",
    "components/InventoryItemArchiveDialog.tsx",
    "components/InventoryItemCameraCapture.tsx",
    "components/InventoryItemCodeScanner.tsx",
    "components/InventoryItemCreateForm.tsx",
    "components/InventoryItemDetails.tsx",
    "components/InventoryItemQrDialogs.tsx",
    "components/InventoryItemServiceDialog.tsx",
    "components/InventoryQrPrintView.tsx",
    "components/InventoryRoomQrScanner.tsx",
    "components/PushNotificationControl.tsx",
    "components/UsersManager.tsx",
  ];

  for (const file of files) {
    const content = await readFile(new URL(file, ROOT), "utf8");
    assert.doesNotMatch(content, /[А-Яа-яЁё]/u, `${file} contains untranslated UI copy`);
  }
});

test("language remains device-local and its controls are available in required order", async () => {
  const [provider, header, authFrame, settingsForm] = await Promise.all([
    readFile(new URL("components/AppSettingsProvider.tsx", ROOT), "utf8"),
    readFile(new URL("components/Header.tsx", ROOT), "utf8"),
    readFile(new URL("components/auth/AuthPageFrame.tsx", ROOT), "utf8"),
    readFile(new URL("components/SettingsForm.tsx", ROOT), "utf8"),
  ]);

  assert.match(
    provider,
    /localSettings\?\.language \?\? DEFAULT_APP_SETTINGS\.language/,
  );
  assert.match(provider, /syncPushSubscriptionLanguage\(settings\.language\)/);
  assert.doesNotMatch(header, /<label className="relative hidden/);
  assert.match(authFrame, /value: "ru"[\s\S]*value: "kk"[\s\S]*value: "en"/);
  assert.match(settingsForm, /value: "ru"[\s\S]*value: "kk"[\s\S]*value: "en"/);
  assert.match(authFrame, /document\.title = `\$\{t\(titleKey\)\} \| YU Inventory`/);
  assert.doesNotMatch(authFrame, />Inventory</);
});
