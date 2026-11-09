import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_APP_SETTINGS, isAppLanguage } from "../lib/app-settings";
import { translate } from "../lib/i18n";

test("Russian is primary and supported language codes are validated", () => {
  assert.equal(DEFAULT_APP_SETTINGS.language, "ru");
  for (const code of ["ru", "kk", "en"]) assert.equal(isAppLanguage(code), true);
  for (const code of ["de", "", "EN"]) assert.equal(isAppLanguage(code), false);
});

test("translation interpolation includes caller data in every supported language", () => {
  for (const language of ["ru", "kk", "en"] as const) {
    const message = translate(language, "push.assignmentBody", { name: "Survey-42" });
    assert.ok(message.includes("Survey-42"));
    assert.equal(message.includes("{name}"), false);
  }
});
