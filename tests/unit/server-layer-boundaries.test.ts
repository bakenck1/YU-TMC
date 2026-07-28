import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  validateServerBoundaries,
  type SourceModules,
} from "../helpers/server-boundary-validator";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function sourceModules(directory: string): Promise<SourceModules> {
  const modules: Record<string, string> = {};

  async function visit(relativeDirectory: string) {
    const absoluteDirectory = path.join(directory, relativeDirectory);
    for (const entry of await readdir(absoluteDirectory, {
      withFileTypes: true,
    })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        modules[relativePath.replaceAll("\\", "/")] = await readFile(
          path.join(directory, relativePath),
          "utf8",
        );
      }
    }
  }

  for (const root of ["app", "components", "lib"]) {
    await visit(root);
  }
  return modules;
}

describe("server layer architecture guard", () => {
  it("keeps the repository source tree inside its declared boundaries", async () => {
    const modules = await sourceModules(process.cwd());
    expect(validateServerBoundaries(modules)).toEqual([]);
  });

  it("rejects direct database access from UI or route handlers", () => {
    expect(
      validateServerBoundaries({
        "components/bad.tsx": '"use client"; import { Pool } from "pg";',
        "app/api/bad/route.ts":
          'import { getDatabase } from "@/lib/db/client";',
        "lib/db/client.ts": 'import "server-only";',
      }),
    ).toEqual([
      'app/api/bad/route.ts: UI/HTTP import graph reaches persistence module "@/lib/db/client" through app/api/bad/route.ts.',
      'components/bad.tsx: UI/HTTP import graph reaches persistence module "pg" through components/bad.tsx.',
      'components/bad.tsx: client import graph reaches server dependency "pg" through components/bad.tsx.',
    ]);
  });

  it("rejects a transitive database import from a route handler", () => {
    expect(
      validateServerBoundaries({
        "app/api/bad/route.ts":
          'import { helper } from "@/lib/helper"; export const GET = helper;',
        "lib/helper.ts":
          'export { getDatabase as helper } from "@/lib/db/client";',
        "lib/db/client.ts": 'import "server-only"; export const getDatabase = () => {};',
      }),
    ).toEqual([
      'app/api/bad/route.ts: UI/HTTP import graph reaches persistence module "@/lib/db/client" through lib/helper.ts.',
    ]);
  });

  it("treats PostgreSQL subpath imports as database access", () => {
    expect(
      validateServerBoundaries({
        "components/direct.tsx":
          '"use client"; import Client from "pg/lib/client.js"; export { Client };',
        "app/api/transitive/route.ts":
          'import { helper } from "@/lib/helper"; export const GET = helper;',
        "lib/helper.ts":
          'import Client from "pg/lib/client.js"; export const helper = Client;',
        "lib/application/service.ts":
          'import { helper } from "@/lib/helper"; export const service = helper;',
      }),
    ).toEqual([
      'app/api/transitive/route.ts: UI/HTTP import graph reaches persistence module "pg/lib/client.js" through lib/helper.ts.',
      'components/direct.tsx: UI/HTTP import graph reaches persistence module "pg/lib/client.js" through components/direct.tsx.',
      'components/direct.tsx: client import graph reaches server dependency "pg/lib/client.js" through components/direct.tsx.',
      'lib/application/service.ts: domain/application import graph reaches infrastructure module "pg/lib/client.js" through lib/helper.ts.',
    ]);
  });

  it("finds a transitive server import from a Client Component", () => {
    expect(
      validateServerBoundaries({
        "components/client.tsx":
          '"use client"; import { helper } from "@/lib/client-helper"; void helper;',
        "lib/client-helper.ts":
          'export { getApplicationServices as helper } from "@/lib/server/application";',
        "lib/server/application.ts": 'import "server-only"; export const x = 1;',
      }),
    ).toEqual([
      "components/client.tsx: client import graph reaches lib/server/application.ts through lib/client-helper.ts.",
    ]);
  });

  it("allows pure shared DTOs in a Client Component", () => {
    expect(
      validateServerBoundaries({
        "components/client.tsx":
          '"use client"; import type { Dto } from "@/lib/contracts/dto";',
        "lib/contracts/dto.ts": "export interface Dto { id: string }",
      }),
    ).toEqual([]);
  });

  it("rejects transitive bare Node built-ins from application code", () => {
    expect(
      validateServerBoundaries({
        "lib/application/service.ts":
          'import { helper } from "@/lib/helper"; export const service = helper;',
        "lib/helper.ts": 'import fs from "fs"; export const helper = fs;',
      }),
    ).toEqual([
      'lib/application/service.ts: domain/application import graph reaches infrastructure module "fs" through lib/helper.ts.',
    ]);
  });

  it("requires an explicit server-only marker on server modules", () => {
    expect(
      validateServerBoundaries({
        "lib/server/missing-marker.ts": "export const value = 1;",
      }),
    ).toEqual([
      'lib/server/missing-marker.ts: server module must import "server-only".',
    ]);
  });
});
