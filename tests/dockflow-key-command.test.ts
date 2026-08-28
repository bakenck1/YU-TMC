import assert from "node:assert/strict";
import test from "node:test";

import { parseDockflowKeyCommandArguments } from "../lib/security/dockflow-key-command";

test("Dockflow key command requires an explicit server target, admin, and action", () => {
  assert.deepEqual(
    parseDockflowKeyCommandArguments([
      "--target=production",
      "--actor-email=ADMIN@YU.EDU.KZ",
      "--action=rotate",
    ]),
    {
      target: "production",
      actorEmail: "admin@yu.edu.kz",
      action: "rotate",
    },
  );
});

test("Dockflow key command rejects unsafe or ambiguous input", () => {
  for (const args of [
    ["--target=production", "--actor-email=admin@outside.test", "--action=create"],
    ["--target=test", "--actor-email=admin@yu.edu.kz", "--action=create"],
    ["--target=production", "--actor-email=admin@yu.edu.kz", "--action=delete"],
    ["--target=production", "--actor-email=admin@yu.edu.kz"],
  ]) {
    assert.throws(() => parseDockflowKeyCommandArguments(args));
  }
});
