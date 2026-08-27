import assert from "node:assert/strict";
import test from "node:test";

import { automaticYessenovLoginTarget } from "../lib/security/login-entry";

test("automatically starts Yessenov SSO for the normal login page", () => {
  assert.equal(
    automaticYessenovLoginTarget({
      enabled: true,
      manualLogin: false,
    }),
    "/api/auth/yessenov",
  );
  assert.equal(
    automaticYessenovLoginTarget({
      enabled: true,
      manualLogin: false,
      returnTo: "/items?status=in-use",
    }),
    "/api/auth/yessenov?returnTo=%2Fitems%3Fstatus%3Din-use",
  );
});

test("keeps the local form available and prevents SSO error loops", () => {
  assert.equal(
    automaticYessenovLoginTarget({
      enabled: true,
      manualLogin: true,
    }),
    null,
  );
  assert.equal(
    automaticYessenovLoginTarget({
      enabled: true,
      manualLogin: false,
      error: "yessenov_failed",
    }),
    null,
  );
  assert.equal(
    automaticYessenovLoginTarget({
      enabled: false,
      manualLogin: false,
    }),
    null,
  );
});
