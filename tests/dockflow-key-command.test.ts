import assert from "node:assert/strict";
import test from "node:test";

import { parseDockflowKeyRegistrationCommandArguments } from "../lib/security/dockflow-key-command";

test("Dockflow key registration requires a target, admin, digest, and safe prefix", () => {
  assert.deepEqual(
    parseDockflowKeyRegistrationCommandArguments([
      "--target=production",
      "--actor-email=ADMIN@YU.EDU.KZ",
      `--key-sha256=${"A".repeat(64)}`,
      "--key-prefix=df_live_Abcd1234",
    ]),
    {
      target: "production",
      actorEmail: "admin@yu.edu.kz",
      keyHashSha256: "a".repeat(64),
      keyPrefix: "df_live_Abcd1234",
    },
  );
});

test("Dockflow key command rejects unsafe or ambiguous input", () => {
  for (const args of [
    ["--target=production", "--actor-email=admin@outside.test", `--key-sha256=${"a".repeat(64)}`, "--key-prefix=df_live_Abcd1234"],
    ["--target=test", "--actor-email=admin@yu.edu.kz", `--key-sha256=${"a".repeat(64)}`, "--key-prefix=df_live_Abcd1234"],
    ["--target=production", "--actor-email=admin@yu.edu.kz", "--key-sha256=not-a-digest", "--key-prefix=df_live_Abcd1234"],
    ["--target=production", "--actor-email=admin@yu.edu.kz", `--key-sha256=${"a".repeat(64)}`, "--key-prefix=secret"],
    ["--target=production", "--actor-email=admin@yu.edu.kz"],
  ]) {
    assert.throws(() => parseDockflowKeyRegistrationCommandArguments(args));
  }
});
