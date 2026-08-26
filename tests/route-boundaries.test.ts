import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("route boundaries use the current Next retry contract", async () => {
  const [errorBoundary, globalError, loading, protectedLoading] = await Promise.all([
    readFile("app/error.tsx", "utf8"),
    readFile("app/global-error.tsx", "utf8"),
    readFile("app/loading.tsx", "utf8"),
    readFile("app/(protected)/loading.tsx", "utf8"),
  ]);

  assert.match(errorBoundary, /unstable_retry/);
  assert.match(globalError, /unstable_retry/);
  assert.match(globalError, /<html lang=\{language\}>/);
  assert.match(globalError, /<body/);
  assert.match(globalError, /fontFamily: "Arial, Helvetica, sans-serif"/);
  assert.match(loading, /RouteLoadingFallback/);
  assert.match(protectedLoading, /RouteLoadingFallback/);
});
