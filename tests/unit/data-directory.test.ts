import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDirectory } from "@/lib/data-directory";

const original = process.env.YU_DATA_DIRECTORY;

afterEach(() => {
  if (original === undefined) delete process.env.YU_DATA_DIRECTORY;
  else process.env.YU_DATA_DIRECTORY = original;
});

describe("dataDirectory", () => {
  it("uses the working .data directory by default", () => {
    delete process.env.YU_DATA_DIRECTORY;
    expect(dataDirectory()).toBe(path.join(process.cwd(), ".data"));
  });

  it("resolves an explicitly isolated data directory", () => {
    process.env.YU_DATA_DIRECTORY = path.join(".", "isolated-data");
    expect(dataDirectory()).toBe(path.resolve("isolated-data"));
  });
});
