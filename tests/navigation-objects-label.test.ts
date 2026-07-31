import assert from "node:assert/strict";
import test from "node:test";

import { translate } from "../lib/i18n";

test("labels the inventory facilities route as Objects in every language", () => {
  assert.equal(translate("ru", "nav.objects"), "Объекты");
  assert.equal(translate("kk", "nav.objects"), "Нысандар");
  assert.equal(translate("en", "nav.objects"), "Facilities");
});
