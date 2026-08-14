# YU Inventory

YU Inventory is a Next.js application for university inventory, QR workflows,
inspections, responsibility transfers, service requests and TMC operations.
The application uses PostgreSQL as its durable source of truth and supports
Russian, Kazakh and English UI languages.

## Prerequisites

- Node.js 22.x (the repository pins the major in `.nvmrc` and rejects other
  Node majors during npm install/ci);
- npm with the committed `package-lock.json`;
- either the project-managed local PostgreSQL fallback or an external/Postgres
  test service;
- Docker Desktop only when using the mobile Compose runtime.

## Local development

```powershell
npm ci
npm run dev
```

With no `DATABASE_URL`, `npm run dev` starts the project-managed persistent
PostgreSQL instance under `%LOCALAPPDATA%/YUInventory/postgres-development`,
applies migrations, imports the local credential when configured, and starts
Next.js. Docker is not required for this path.

For an external development database, copy `.env.example` to `.env.local`, set
the dedicated database variables, then run:

```powershell
npm run db:migrate -- --target=development
npm run db:smoke -- --target=development
```

The application routes live under `app/`; reusable UI and screen components
live under `components/`. There is no starter `app/page.tsx` to edit.

## Verification commands

```powershell
npm run lint
npm run ui:check
npm run docs:check
npm run legacy:check
npm run test:all
npm run test:database:local
npm run db:check
npm run build
npm start
npm run security:check
```

`npm run test:all` always runs server, UI and component suites. PostgreSQL
integration suites require `TEST_DATABASE_URL` and
`TEST_DATABASE_MIGRATOR_URL`; CI provides them and fails if they are absent.
Without those variables a local run reports the database suite as skipped.
Use `npm run test:database:local` to start the isolated local PostgreSQL path
and run the database suites explicitly.

For a clean development database, use the guarded command:

```powershell
npm run db:reset -- --target=development --confirm=DELETE_ALL_APPLICATION_DATA
```

It removes application data but not schema or migration history.

## Google Workspace SSO

Create a Google Cloud OAuth web client and register:

```text
http://localhost:3000/api/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
`GOOGLE_WORKSPACE_DOMAIN=yu.edu.kz` in `.env.local`. Production callback URLs
must use HTTPS. The callback verifies the ID token, nonce, audience, verified
email and Workspace domain before creating an application session.

## Web Push

Generate one VAPID key pair and store it in the deployment secret store:

```powershell
npx web-push generate-vapid-keys --json
```

Set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and
`WEB_PUSH_VAPID_SUBJECT`. Push delivery is best-effort: authoritative inventory
transactions commit first, while transient push failures are retried and final
failures are logged. The durable TMC outbox is processed by:

```powershell
npm run worker:tmc-push
```

## Mobile Docker runtime

```powershell
npm run docker:mobile:up
```

The mobile setup starts the app, PostgreSQL, migrations, HTTPS proxy and push
worker. It uses an ASCII temporary build path when the repository path contains
Cyrillic characters. See `docker-compose.mobile.yml` and `Caddyfile.mobile` for
the local network address and certificate endpoint.

## Database and release operations

PostgreSQL environment separation, migration ordering, restricted roles,
legacy import, backups and deployment rules are documented in
[docs/database.md](docs/database.md). The production monitoring command is
documented in [docs/production-monitoring.md](docs/production-monitoring.md).
The release gate checklist is maintained in
[docs/release-checklist.md](docs/release-checklist.md).
The functional coverage matrix and TDD boundary rules are maintained in
[docs/test-coverage.md](docs/test-coverage.md).
The compatibility inventory and legacy sunset policy are maintained in
[docs/legacy-compatibility.md](docs/legacy-compatibility.md).

Run the documentation contract itself with:

```powershell
npm run docs:check
npm run legacy:check
```

The package is private and intentionally retains the existing npm name
`my-next-app` for compatibility with local tooling; it is not a published
package identity.
