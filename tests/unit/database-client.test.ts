import { text, pgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createDrizzleDatabase } from "@/lib/db/client";

const exampleTable = pgTable("example", {
  createdAt: text().notNull(),
});

describe("database client", () => {
  it("uses the same snake_case mapping as migration generation", () => {
    const database = createDrizzleDatabase({} as Pool);
    const query = database.select().from(exampleTable).toSQL();

    expect(query.sql).toContain('"created_at"');
    expect(query.sql).not.toContain('"createdAt"');
  });
});
