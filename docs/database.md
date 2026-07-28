# PostgreSQL foundation

PostgreSQL is the durable source of application data. Drizzle owns the typed
schema and committed, forward-only SQL migrations; `node-postgres` provides one
bounded pool per Node.js process. Database modules are server-only and are
created lazily, so importing application code during `next build` does not
require a reachable database.

## Environment separation

Development and production use `DATABASE_URL`. Tests have no fallback and must
use `TEST_DATABASE_URL`, whose database name must end in `_test`. When both URLs
are present, startup rejects configurations that resolve to the same host, port
and database even if the usernames differ. Every target also has a stable,
non-secret logical identity (`DATABASE_DEPLOYMENT_ID` or
`TEST_DATABASE_DEPLOYMENT_ID`); test and non-test identities must differ.

Migration commands always require an explicit target. Development may reuse
its runtime role locally. Tests and production require
`TEST_DATABASE_MIGRATOR_URL` and `DATABASE_MIGRATOR_URL` respectively, using a
different schema-owner role and the same case-sensitive database name. The
migrator host and port may differ deliberately:
`DATABASE_URL` may use a transaction pooler, while migrations must use a direct
or session-pooling endpoint because their advisory lock is session-scoped.
Never point `DATABASE_MIGRATOR_URL` at a transaction-pooling endpoint.

The migration runner grants the runtime role schema `USAGE`, application-table
`SELECT`/`INSERT`/`UPDATE`, and sequence `USAGE`/`SELECT`. It revokes writes to
`yu_inventory.__schema_contract`; repositories never receive hard-delete,
schema-owner, `CREATE`, or migration-history privileges.

TLS is configured separately from the URL:

- `disable` is the local development/test default and is always rejected in
  production.
- `require` encrypts traffic without validating the server certificate and is
  intended only for explicitly trusted private networks. Production rejects it
  unless `DATABASE_ALLOW_UNVERIFIED_TLS=true` is deliberately set.
- `verify-full` validates the certificate and is the production default.
- `DATABASE_SSL_CA` (or `TEST_DATABASE_SSL_CA`) supplies a private CA when the
  provider does not use a public trust root.

Connection URL query strings are rejected completely. `node-postgres` accepts
query parameters that can override the parsed host, user, timeouts, TLS and
search path, so allowing them would undermine environment isolation. Configure
all connection options through the dedicated variables above.

Pool sizes and timeouts use these optional integer settings:

```text
DATABASE_POOL_MAX
DATABASE_CONNECTION_TIMEOUT_MS
DATABASE_IDLE_TIMEOUT_MS
DATABASE_STATEMENT_TIMEOUT_MS
DATABASE_MIGRATION_LOCK_TIMEOUT_MS
```

Tests use the equivalent `TEST_DATABASE_*` names and do not inherit these
values. In horizontally scaled or serverless deployments, total PostgreSQL
connections equal the pool limit multiplied by the number of warm instances;
set a small limit or use the provider's transaction pooler for runtime traffic.

## Local development

The Compose file is for development and tests only:

```powershell
docker compose --profile development up -d --wait postgres-development
Copy-Item .env.example .env.local
npm run db:migrate -- --target=development
npm run db:smoke -- --target=development
```

The development data volume is persistent. The test service uses temporary
storage and the committed `.env.test` contains local-only, non-secret defaults:

```powershell
docker compose --profile test up -d --wait postgres-test
npm run test:db
```

CI should provision a native PostgreSQL service or an ephemeral managed
database and override `TEST_DATABASE_URL` and
`TEST_DATABASE_MIGRATOR_URL` with distinct runtime and migrator roles, while
giving the database a unique `TEST_DATABASE_DEPLOYMENT_ID`. The committed
Compose setup creates both roles so the suite can verify runtime grants and
denials. `test:db` deliberately fails if the service or credentials are absent;
it never skips database verification silently.

## Migration workflow

Create a migration after changing `lib/db/schema.ts`, review its SQL, and commit
both the SQL and Drizzle metadata:

```powershell
npm run db:generate -- --name=describe-change
npm run db:check
```

Drizzle hashes SQL byte-for-byte. `.gitattributes` pins migration SQL and
metadata to LF so a migration applied from Windows has the same history hash as
one verified from Linux.

Apply migrations once in a deployment job before shifting traffic:

```powershell
npm run db:migrate -- --target=production
npm run db:smoke -- --target=production
```

Do not run migrations in a request handler, Next.js instrumentation, or each
application instance on startup. The migration runner holds a session advisory
lock on one dedicated connection, so overlapping deploy jobs serialize. Each
migration runs transactionally through Drizzle. Before and after applying SQL,
the runner compares every stored timestamp and hash with the committed manifest
and rejects edited, missing, reordered, or unknown migration history. Before
reporting success it also reconnects through the runtime URL and verifies that
the exact schema contract is visible there; a direct endpoint aimed at another
cluster therefore blocks the deployment.

Migrations are append-only after they have been shared. Drizzle migrations are
up-only: recover through a forward fix or a tested backup restore, not an
assumed generated down migration. During rolling deployments, schema changes
must remain compatible with the previously deployed application version.

`yu_inventory` contains application objects. Drizzle stores migration history
separately in `yu_migrations.__drizzle_migrations`. Application schema objects
are always qualified; connections use a restricted search path rather than
implicitly trusting `public`.

The bootstrap migration creates the technical
`yu_inventory.__schema_contract`; it is not a domain entity. Later migrations
add application tables such as persistent users. After migration,
the runner records the logical deployment ID and a hash of the complete
migration manifest there. `db:smoke` connects through both credentials: the
migrator role verifies the complete private history, while the runtime role
must have schema access and see the exact deployment ID and manifest hash.
Therefore a manually created empty schema or a pooler pointed at another
database cannot pass the release check.

## Moving legacy authentication to PostgreSQL

PostgreSQL is the only runtime source for users, roles and password hashes.
Legacy `.data/auth-credentials.json` and `AUTH_ADMIN_*` values are import inputs
only; request handlers never fall back to them when PostgreSQL is unavailable.

Before the first DB-aware release:

1. Back up `.data/auth-credentials.json` and `.data/session-secret`.
2. Put the exact old session-secret value into `SESSION_SECRET`. Changing it
   signs out every existing browser immediately.
3. Stop registration and password-reset writes on the old release.
4. Apply migrations, then import the active legacy source:

```powershell
npm run db:migrate -- --target=production
npm run db:import-auth -- --target=production
npm run db:smoke -- --target=production
```

The importer preserves the existing scrypt salt/hash and role, is idempotent
for an identical rerun, and aborts on corrupt files, incomplete environment
configuration, or conflicting database data. A valid credential file keeps
the old file-over-environment precedence. Do not delete the backup until the
DB-aware release has completed its soak period.

Existing signed cookies keep their `{sub=email,name,role,...}` format. On every
secure server operation, `sub` resolves the current PostgreSQL user; the name
and role embedded in an old cookie are compatibility snapshots only.
Deactivation, role changes and soft deletion therefore take effect without
waiting for the cookie to expire. Existing user email is immutable during this
migration because old cookies use email as their subject.

After any DB-side password, role, status, or multi-user change, rolling back to
the old single-file binary is not lossless. Roll back only to an earlier
DB-aware release, restore a tested backup, or deploy a forward fix.
