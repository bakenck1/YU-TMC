# YU Inventory

YU Inventory is a Next.js application for university inventory, QR workflows,
inspections, responsibility transfers, service requests and TMC operations.
The application uses PostgreSQL as its durable source of truth and supports
Russian, Kazakh and English UI languages.

## Prerequisites

- Node.js 24.15+ within the Node 24 major (the repository pins the CI baseline
  in `.nvmrc` and rejects unsupported Node versions during npm install/ci);
- npm with the committed `package-lock.json`;
- either the project-managed local PostgreSQL fallback or an external/Postgres
  test service;

## Local development

```powershell
npm ci
npm run dev
```

With no `DATABASE_URL`, `npm run dev` starts the project-managed persistent
PostgreSQL instance under `%LOCALAPPDATA%/YUInventory/postgres-development`,
applies migrations, imports the local credential when configured, and starts
Next.js.

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
npm run artifacts:check
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

## Yessenov ID SSO

Register the production entry URL
`https://inventory.yu.edu.kz/api/auth/yessenov` and exact callback
`https://inventory.yu.edu.kz/api/auth/yessenov/callback` with Yessenov ID.
Configure `YESSENOV_OIDC_CLIENT_ID`, `YESSENOV_OIDC_CLIENT_SECRET` and
`YESSENOV_OIDC_REDIRECT_URI`. First login creates an `employee`; elevated roles
remain local administrator decisions. See [docs/yessenov-sso.md](docs/yessenov-sso.md)
for provider claims and the guarded personnel JSON import.

## WhatsApp notifications

Set `WA_GATEWAY_URL`, `WA_API_TOKEN` and `WA_SESSION` in the server's private
`.env.local` or deployment secret store. Obtain the Bearer token and session
name from the YU WA Gateway administrator. Never use a `NEXT_PUBLIC_` prefix
or put the token in a browser request. Apply database migrations before enabling
the token. Without `WA_API_TOKEN`, this integration stays disabled.

When an administrator saves a user's phone number, the server normalizes it to
`7XXXXXXXXXX` and calls `/v1/check`. Unregistered numbers are rejected. If the
gateway is temporarily unavailable, other user changes are saved while the new
phone number is left unsaved and the UI shows a warning. Numbers imported from
Yessenov ID are not checked during sign-in; they are checked before a send.

For internal service requests, the author receives `generic_status` on creation
and on status changes to “in progress” or “completed”. Chat messages and
dormitory-origin requests do not send WhatsApp. The server records a 45-minute
cooldown per request and template in PostgreSQL. On HTTP 429 it stores the
gateway's `Retry-After` pause for the session; failed notifications do not
roll back the request or status change. Delivery is best effort; skipped or
failed sends are not replayed automatically.

Gateway checks from an administrator's shell (replace `TOKEN` locally):

```bash
curl -X POST http://wa.yu.edu.kz/v1/check -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"session":"otinish","to":"77011112233"}'
curl -X POST http://wa.yu.edu.kz/v1/send -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"session":"otinish","to":"77011112233","template":"generic_status","data":{"title":"YU Inventory","ticket":"ABC-123","status":"В работе","extra":"Подробности в личном кабинете"}}'
```
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

## Production deployment

Production uses a regular Node.js process managed by systemd, with Nginx in
front and PostgreSQL as an external or local system service. Ready-to-use unit
files, an Nginx virtual host and the deployment procedure are in
[deploy/README.md](deploy/README.md).

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
The audit, generated-history and repository-artifact policy is maintained in
[docs/repository-artifacts.md](docs/repository-artifacts.md).

Run the documentation contract itself with:

```powershell
npm run docs:check
npm run legacy:check
npm run artifacts:check
```

The package is private and intentionally retains the existing npm name
`my-next-app` for compatibility with local tooling; it is not a published
package identity.
