import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("read-only mobile runtime provides a bounded writable Next image cache", () => {
  const compose = readFileSync("docker-compose.mobile.yml", "utf8");
  const dockerfile = readFileSync("Dockerfile.mobile", "utf8");

  assert.match(compose, /app:[\s\S]*?read_only:\s*true/);
  assert.match(
    compose,
    /\/app\/\.next\/cache:size=64m,mode=0700,uid=1001,gid=1001,noexec,nosuid,nodev/,
  );
  assert.match(dockerfile, /mkdir -p \/app\/\.next\/cache/);
});
