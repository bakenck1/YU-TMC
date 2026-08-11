import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import { readHiddenPageResource } from "../lib/server/security/hidden-page-resource";

test("item detail page hides foreign and missing object IDs behind the same 404", async () => {
  const missing = await captureFailure(() =>
    readHiddenPageResource(async () => {
      throw new ApplicationError("not_found", "item_not_found");
    }, hideAsNotFound),
  );
  const foreign = await captureFailure(() =>
    readHiddenPageResource(async () => {
      throw new ApplicationError("forbidden", "forbidden");
    }, hideAsNotFound),
  );

  assert.deepEqual(errorShape(missing), {
    message: "NEXT_HTTP_ERROR_FALLBACK;404",
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
  assert.deepEqual(errorShape(foreign), errorShape(missing));
});

test("item detail page does not disguise unexpected failures as missing objects", async () => {
  const unavailable = new ApplicationError("unavailable", "items_unavailable");

  await assert.rejects(
    readHiddenPageResource(async () => {
      throw unavailable;
    }, hideAsNotFound),
    (error: unknown) => error === unavailable,
  );
});

test("item detail page applies hidden-object handling to primary and nested reads", () => {
  const source = readFileSync(
    new URL("../app/(protected)/items/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/await readHiddenPageResource\(/g)?.length, 2);
  assert.match(source, /if \(isUuid\(id\)\)/);
  assert.doesNotMatch(source, /\[1-5\]\[0-9a-f\]/);
  assert.match(
    source,
    /readHiddenPageResource\(\s*\(\) => services\.items\.findItem\(id, actor\),\s*notFound,/,
  );
  assert.match(
    source,
    /readHiddenPageResource\([\s\S]*?Promise\.all\(\[[\s\S]*?listComponents\(id, actor\)[\s\S]*?listOperations\(id, actor\)[\s\S]*?listComments\(id, actor\)[\s\S]*?notFound,/,
  );
  assert.doesNotMatch(
    source,
    /if \(!isInventoryBuildingName\(item\.room\.buildingName\)\) notFound\(\);/,
  );
});

async function captureFailure(read: () => Promise<unknown>): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  assert.fail("expected the page resource read to fail");
}

function hideAsNotFound(): never {
  throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
}

function errorShape(error: unknown) {
  assert.ok(error instanceof Error);
  return {
    message: error.message,
    digest:
      "digest" in error && typeof error.digest === "string"
        ? error.digest
        : undefined,
  };
}
