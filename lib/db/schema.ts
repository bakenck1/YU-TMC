import { pgSchema } from "drizzle-orm/pg-core";

/**
 * All application tables are schema-qualified so PostgreSQL's public schema is
 * never an implicit source of application objects. Drizzle does not record an
 * empty pgSchema in its snapshot or generate CREATE SCHEMA for its first table;
 * the committed bootstrap migration deliberately creates this namespace.
 */
export const inventorySchema = pgSchema("yu_inventory");
