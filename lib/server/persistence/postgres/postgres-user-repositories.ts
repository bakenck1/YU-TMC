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
  SynchronizeDirectoryUserRecord,
  UpdateUserRecord,
  UserRecord,
  UserDirectoryEntryRecord,
  UserRepositories,
  UserRepository,
} from "@/lib/application/ports/user-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

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
  iin: string | null;
  org_unit: string | null;
  position: string | null;
  tutor_id: string | null;
  role: UserRecord["role"];
  phone: string | null;
  default_room_id: string | null;
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

interface UserDirectoryEntryRow extends QueryResultRow {
  id: string;
  full_name: string;
  email: string;
  role: UserDirectoryEntryRecord["role"];
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

  async lockDirectorySynchronization(): Promise<void> {
    await this.source.query(
      "select pg_advisory_xact_lock(hashtext('yu_inventory_yessenov_directory_sync'))",
    );
  }

  async list(): Promise<UserRecord[]> {
    const result = await this.source.query<UserRow>(
      `select *
       from ${USERS}
       order by created_at desc, id
       ${sqlCollectionLimit(COLLECTION_LIMITS.users)}`,
    );
    return assertCollectionSize(result.rows, COLLECTION_LIMITS.users).map(mapUser);
  }

  async searchActiveRecipients(
    query: string,
    excludeUserId: string,
    limit: number,
  ): Promise<UserDirectoryEntryRecord[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 20));
    const result = await this.source.query<UserDirectoryEntryRow>(
      `select id, full_name, email, role
       from ${USERS}
       where is_active = true
         and deleted_at is null
         and id <> $2
         and (
           position($1 in lower(full_name)) > 0
           or position($1 in lower(email)) > 0
         )
       order by lower(full_name), lower(email), id
       limit $3`,
      [query, excludeUserId, boundedLimit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name.trim(),
      email: row.email,
      role: row.role,
    }));
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

  async findByIinForUpdate(iin: string): Promise<UserRecord | null> {
    const result = await this.source.query<UserRow>(
      `select *
       from ${USERS}
       where iin = $1
         and deleted_at is null
       for update`,
      [iin],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async insert(input: InsertUserRecord): Promise<UserRecord> {
    try {
      const result = await this.source.query<UserRow>(
        `insert into ${USERS}
           (id, code, email, full_name, iin, org_unit, "position", tutor_id,
            role, phone, default_room_id, email_verified,
            is_active, created_at, updated_at, deactivated_at)
         values (
           $1,
           'USR-' || lpad(nextval('${CODE_SEQUENCE}')::text, 6, '0'),
           $2, $3, $4, $5, $6, $7, $8, $9::varchar, $10::uuid, $11::boolean, $12::boolean,
           $13::timestamptz, $13::timestamptz,
           case
             when $12::boolean then null
             else $13::timestamptz
           end
         )
         returning *`,
        [
          input.id,
          input.email,
          input.fullName,
          input.iin ?? null,
          input.orgUnit ?? null,
          input.position ?? null,
          input.tutorId ?? null,
          input.role,
          input.phone,
          input.defaultRoomId ?? null,
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
      if (
        postgresCode(error) === "23505" &&
        postgresConstraint(error) === "users_active_iin_unique"
      ) {
        throw new ApplicationError("conflict", "iin_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async update(input: UpdateUserRecord): Promise<UserRecord | null> {
    try {
      const result = await this.source.query<UserRow>(
      `update ${USERS}
       set full_name = $2,
           iin = coalesce($3, iin),
           org_unit = coalesce($4, org_unit),
           "position" = coalesce($5, "position"),
           tutor_id = coalesce($6, tutor_id),
           role = $7,
           phone = $8,
           default_room_id = $9,
           email_verified = $10,
           is_active = $11,
           updated_at = $12,
           deactivated_at = case
             when $11 then null
             else coalesce(deactivated_at, $12)
           end,
           version = version + 1
       where id = $1
         and version = $13
         and deleted_at is null
       returning *`,
      [
        input.id,
        input.fullName,
        input.iin ?? null,
        input.orgUnit ?? null,
        input.position ?? null,
        input.tutorId ?? null,
        input.role,
        input.phone,
        input.defaultRoomId ?? null,
        input.emailVerified,
        input.active,
        input.updatedAt,
        input.expectedVersion,
      ],
    );
      return result.rows[0] ? mapUser(result.rows[0]) : null;
    } catch (error) {
      if (
        postgresCode(error) === "23505" &&
        postgresConstraint(error) === "users_active_iin_unique"
      ) {
        throw new ApplicationError("conflict", "iin_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
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

  async synchronizeDirectoryUser(
    input: SynchronizeDirectoryUserRecord,
  ): Promise<UserRecord | null> {
    const candidates = await this.source.query<UserRow>(
      `select *
       from ${USERS}
       where email = $1
          or (deleted_at is null and iin = $2)
       for update`,
      [input.email, input.iin],
    );
    if (candidates.rows.length > 1 || candidates.rows[0]?.deleted_at) {
      return null;
    }
    const current = candidates.rows[0] ? mapUser(candidates.rows[0]) : null;
    if (!current) {
      return this.insert({
        id: input.id,
        email: input.email,
        fullName: input.fullName,
        iin: input.iin,
        orgUnit: input.orgUnit,
        position: input.position,
        tutorId: input.personnelId,
        role: "employee",
        phone: input.phone,
        emailVerified: true,
        active: true,
        createdAt: input.synchronizedAt,
      });
    }
    // Email and application role are local identity/security fields. Keeping
    // them stable avoids invalidating an active session or importing provider
    // privileges. The current directory email is still returned by the
    // management list for display.
    if (
      current.fullName === input.fullName &&
      current.iin === input.iin &&
      (current.orgUnit ?? null) === input.orgUnit &&
      (current.position ?? null) === input.position &&
      (current.tutorId ?? null) === input.personnelId &&
      current.phone === input.phone &&
      current.emailVerified
    ) {
      return current;
    }
    const result = await this.source.query<UserRow>(
      `update ${USERS}
       set full_name = $2,
           iin = $3,
           org_unit = $4,
           "position" = $5,
           tutor_id = $6,
           phone = $7,
           email_verified = true,
           updated_at = $8
       where id = $1
         and deleted_at is null
       returning *`,
      [
        current.id,
        input.fullName,
        input.iin,
        input.orgUnit,
        input.position,
        input.personnelId,
        input.phone,
        input.synchronizedAt,
      ],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async isActiveRoom(id: string): Promise<boolean> {
    const result = await this.source.query(
      `select 1 from "yu_inventory"."rooms" where id = $1 and status = 'active'`,
      [id],
    );
    return (result.rowCount ?? 0) === 1;
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
    iin?: string | null,
  ): Promise<void> {
    const keys = [
      `external-identity:${provider}:subject:${subject}`,
      `external-identity:${provider}:email:${email}`,
      ...(iin ? [`external-identity:${provider}:iin:${iin}`] : []),
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
         and identities.subject = $2
       for update of users`,
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
    iin: row.iin,
    orgUnit: row.org_unit,
    position: row.position,
    tutorId: row.tutor_id,
    role: row.role,
    phone: row.phone,
    defaultRoomId: row.default_room_id,
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
