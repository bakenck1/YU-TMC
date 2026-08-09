import "server-only";

import type { QueryResultRow } from "pg";

import type {
  AuthBootstrapRepository,
  ExternalIdentityRecord,
  ExternalIdentityRepository,
  InsertPasswordCredential,
  InsertUserRecord,
  PasswordCredentialRecord,
  PasswordCredentialRepository,
  UpdateUserRecord,
  UserRecord,
  UserRepositories,
  UserRepository,
} from "@/lib/application/ports/user-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const USERS = '"yu_inventory"."users"';
const CREDENTIALS = '"yu_inventory"."user_password_credentials"';
const EXTERNAL_IDENTITIES = '"yu_inventory"."user_external_identities"';
const BOOTSTRAP = '"yu_inventory"."auth_bootstrap"';
const CODE_SEQUENCE = '"yu_inventory"."user_code_sequence"';

interface UserRow extends QueryResultRow {
  id: string;
  code: string;
  email: string;
  full_name: string;
  role: UserRecord["role"];
  phone: string | null;
  email_verified: boolean;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
  deleted_at: Date | null;
}

interface CredentialRow extends QueryResultRow {
  user_id: string;
  salt: string;
  hash: string;
  updated_at: Date;
}

export function createPostgresUserRepositories(
  source: PostgresRepositorySource,
): UserRepositories {
  return {
    users: new PostgresUserRepository(source),
    credentials: new PostgresPasswordCredentialRepository(source),
    externalIdentities: new PostgresExternalIdentityRepository(source),
    bootstrap: new PostgresAuthBootstrapRepository(source),
  };
}

class PostgresUserRepository implements UserRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async list(): Promise<UserRecord[]> {
    const result = await this.source.query<UserRow>(
      `select *
       from ${USERS}
       order by created_at desc, id`,
    );
    return result.rows.map(mapUser);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select * from ${USERS} where id = $1`,
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select * from ${USERS} where id = $1 for update`,
      [id],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByNormalizedEmail(email: string): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select * from ${USERS} where email = $1`,
      [email],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByNormalizedEmailForUpdate(
    email: string,
  ): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select * from ${USERS} where email = $1 for update`,
      [email],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async insert(input: InsertUserRecord): Promise<UserRecord> {
    try {
      const result = await this.source.query<UserRow>(
        `insert into ${USERS}
           (id, code, email, full_name, role, phone, email_verified,
            is_active, created_at, updated_at, deactivated_at)
         values (
           $1,
           'USR-' || lpad(nextval('${CODE_SEQUENCE}')::text, 6, '0'),
           $2, $3, $4, $5::varchar, $6::boolean, $7::boolean,
           $8::timestamptz, $8::timestamptz,
           case
             when $7::boolean then null
             else $8::timestamptz
           end
         )
         returning *`,
        [
          input.id,
          input.email,
          input.fullName,
          input.role,
          input.phone,
          input.emailVerified,
          input.active,
          input.createdAt,
        ],
      );
      return mapRequiredUser(result.rows[0]);
    } catch (error) {
      if (
        postgresCode(error) === "23505" &&
        postgresConstraint(error) === "users_email_unique"
      ) {
        throw new ApplicationError("conflict", "email_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async update(input: UpdateUserRecord): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `update ${USERS}
       set full_name = $2,
           role = $3,
           phone = $4,
           email_verified = $5,
           is_active = $6,
           updated_at = $7,
           deactivated_at = case
             when $6 then null
             else coalesce(deactivated_at, $7)
           end,
           version = version + 1
       where id = $1
         and version = $8
         and deleted_at is null
       returning *`,
      [
        input.id,
        input.fullName,
        input.role,
        input.phone,
        input.emailVerified,
        input.active,
        input.updatedAt,
        input.expectedVersion,
      ],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async softDelete(
    id: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `update ${USERS}
       set is_active = false,
           deactivated_at = coalesce(deactivated_at, $3),
           deleted_at = $3,
           updated_at = $3,
           version = version + 1
       where id = $1
         and version = $2
         and deleted_at is null
       returning *`,
      [id, expectedVersion, deletedAt],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async countActiveAdminsForUpdate(): Promise<number> {
    const result = await this.source.query<{ id: string } & QueryResultRow>(
      `select id
       from ${USERS}
       where role = 'admin'
         and is_active = true
         and deleted_at is null
       for update`,
    );
    return result.rowCount ?? result.rows.length;
  }
}

class PostgresExternalIdentityRepository
  implements ExternalIdentityRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async lockProvisioning(
    provider: ExternalIdentityRecord["provider"],
    subject: string,
    email: string,
  ): Promise<void> {
    const keys = [
      `external-identity:${provider}:subject:${subject}`,
      `external-identity:${provider}:email:${email}`,
    ].sort();
    for (const key of keys) {
      await this.source.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [key],
      );
    }
  }

  async findUserBySubject(
    provider: ExternalIdentityRecord["provider"],
    subject: string,
  ): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select users.*
       from ${USERS} as users
       inner join ${EXTERNAL_IDENTITIES} as identities
         on identities.user_id = users.id
       where identities.provider = $1
         and identities.subject = $2`,
      [provider, subject],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByUser(
    provider: ExternalIdentityRecord["provider"],
    userId: string,
  ): Promise<ExternalIdentityRecord | null> {
    const result = await this.source.query<
      {
        provider: ExternalIdentityRecord["provider"];
        subject: string;
        user_id: string;
        email_at_link: string;
        created_at: Date;
      } & QueryResultRow
    >(
      `select provider, subject, user_id, email_at_link, created_at
       from ${EXTERNAL_IDENTITIES}
       where provider = $1 and user_id = $2`,
      [provider, userId],
    );
    const row = result.rows[0];
    return row
      ? {
          provider: row.provider,
          subject: row.subject,
          userId: row.user_id,
          emailAtLink: row.email_at_link,
          createdAt: row.created_at,
        }
      : null;
  }

  async insert(input: ExternalIdentityRecord): Promise<void> {
    try {
      await this.source.query(
        `insert into ${EXTERNAL_IDENTITIES}
           (provider, subject, user_id, email_at_link, created_at)
         values ($1, $2, $3, $4, $5)`,
        [
          input.provider,
          input.subject,
          input.userId,
          input.emailAtLink,
          input.createdAt,
        ],
      );
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new ApplicationError("conflict", "external_identity_conflict", {
          cause: error,
        });
      }
      throw error;
    }
  }
}

class PostgresPasswordCredentialRepository
  implements PasswordCredentialRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async findByUserId(userId: string): Promise<PasswordCredentialRecord | null> {
    const result = await this.source.query<CredentialRow>(
      `select user_id, salt, hash, updated_at
       from ${CREDENTIALS}
       where user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? {
          userId: row.user_id,
          salt: row.salt,
          hash: Buffer.from(row.hash, "hex"),
          updatedAt: row.updated_at,
        }
      : null;
  }

  async insert(input: InsertPasswordCredential): Promise<void> {
    await this.source.query(
      `insert into ${CREDENTIALS}
         (user_id, salt, hash, scrypt_n, scrypt_r, scrypt_p, key_length, updated_at)
       values ($1, $2, $3, 16384, 8, 5, 64, $4)`,
      [input.userId, input.salt, Buffer.from(input.hash).toString("hex"), input.updatedAt],
    );
  }

  async replace(input: InsertPasswordCredential): Promise<boolean> {
    const result = await this.source.query(
      `update ${CREDENTIALS}
       set salt = $2,
           hash = $3,
           algorithm = 'scrypt',
           scrypt_n = 16384,
           scrypt_r = 8,
           scrypt_p = 5,
           key_length = 64,
           updated_at = $4
       where user_id = $1`,
      [input.userId, input.salt, Buffer.from(input.hash).toString("hex"), input.updatedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }
}

class PostgresAuthBootstrapRepository implements AuthBootstrapRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async isComplete(): Promise<boolean> {
    const result = await this.source.query<
      { complete: boolean } & QueryResultRow
    >(
      `select completed_at is not null as complete
       from ${BOOTSTRAP}
       where singleton = true`,
    );
    return result.rows[0]?.complete === true;
  }

  async lockAndRead(): Promise<{ complete: boolean }> {
    const result = await this.source.query<
      { complete: boolean } & QueryResultRow
    >(
      `select completed_at is not null as complete
       from ${BOOTSTRAP}
       where singleton = true
       for update`,
    );
    if (!result.rows[0]) {
      throw new Error("Auth bootstrap row is missing.");
    }
    return result.rows[0];
  }

  async complete(firstAdminUserId: string, completedAt: Date): Promise<void> {
    const result = await this.source.query(
      `update ${BOOTSTRAP}
       set completed_at = $1,
           first_admin_user_id = $2
       where singleton = true
         and completed_at is null`,
      [completedAt, firstAdminUserId],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new ApplicationError("conflict", "registration_closed");
    }
  }
}

function mapRequiredUser(row: UserRow | undefined): UserRecord {
  if (!row) throw new Error("PostgreSQL did not return the inserted user.");
  return mapUser(row);
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    phone: row.phone,
    emailVerified: row.email_verified,
    active: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
    deletedAt: row.deleted_at,
  };
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function postgresConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("constraint" in error)) return;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}
