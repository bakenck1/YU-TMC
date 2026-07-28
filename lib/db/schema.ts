import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { USER_ROLES } from "@/lib/contracts/users";

/**
 * All application tables are schema-qualified so PostgreSQL's public schema is
 * never an implicit source of application objects. Drizzle does not record an
 * empty pgSchema in its snapshot or generate CREATE SCHEMA for its first table;
 * the committed bootstrap migration deliberately creates this namespace.
 */
export const inventorySchema = pgSchema("yu_inventory");

export const authRoleEnum = inventorySchema.enum("auth_role", USER_ROLES);

export const userCodeSequence = inventorySchema.sequence(
  "user_code_sequence",
  {
    startWith: 1,
    increment: 1,
    minValue: 1,
    cache: 1,
  },
);

export const usersTable = inventorySchema.table(
  "users",
  {
    id: uuid().primaryKey(),
    code: varchar({ length: 32 }).notNull().unique(),
    email: varchar({ length: 254 }).notNull().unique(),
    fullName: varchar({ length: 120 }).notNull(),
    role: authRoleEnum().notNull(),
    phone: varchar({ length: 32 }),
    emailVerified: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    deactivatedAt: timestamp({ withTimezone: true, mode: "date" }),
    deletedAt: timestamp({ withTimezone: true, mode: "date" }),
  },
  (table) => [
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
    check("users_version_positive_check", sql`${table.version} > 0`),
    check(
      "users_deactivated_state_check",
      sql`${table.isActive} OR ${table.deactivatedAt} IS NOT NULL`,
    ),
  ],
);

export const userPasswordCredentialsTable = inventorySchema.table(
  "user_password_credentials",
  {
    userId: uuid()
      .primaryKey()
      .references(() => usersTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    algorithm: varchar({ length: 16 }).notNull().default("scrypt"),
    salt: text().notNull(),
    hash: text().notNull(),
    scryptN: integer().notNull().default(16_384),
    scryptR: integer().notNull().default(8),
    scryptP: integer().notNull().default(1),
    keyLength: integer().notNull().default(64),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    check(
      "user_password_credentials_algorithm_check",
      sql`${table.algorithm} = 'scrypt'`,
    ),
    check(
      "user_password_credentials_hash_check",
      sql`${table.hash} ~ '^[0-9a-f]{128}$'`,
    ),
    check(
      "user_password_credentials_parameters_check",
      sql`${table.scryptN} = 16384 AND ${table.scryptR} = 8 AND ${table.scryptP} = 1 AND ${table.keyLength} = 64`,
    ),
  ],
);

export const authBootstrapTable = inventorySchema.table(
  "auth_bootstrap",
  {
    singleton: boolean().primaryKey().default(true),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    firstAdminUserId: uuid().references(() => usersTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    check("auth_bootstrap_singleton_check", sql`${table.singleton} = true`),
    check(
      "auth_bootstrap_completion_check",
      sql`(${table.completedAt} IS NULL) = (${table.firstAdminUserId} IS NULL)`,
    ),
  ],
);
