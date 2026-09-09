# Browser smoke

Owner: **Inventory Platform maintainers**.

`npm run test:browser-smoke` performs the two deliberately narrow Chromium journeys
against a production Next.js build:

1. local-password login, protected profile access, refresh, logout and rejected
   protected access after logout;
2. an employee issues the seeded inventory item from the UI and the selected recipient
   accepts the resulting transfer request from the UI.

On Windows x64 the command creates an embedded PostgreSQL cluster under an OS temporary
directory. On other platforms it requires both `TEST_DATABASE_URL` and
`TEST_DATABASE_MIGRATOR_URL`; both URLs must name a database ending in `_test` and must
use different roles on the loopback interface. Remote PostgreSQL hosts are rejected even
when their database name ends in `_test`. Both URLs must resolve to the same host, port and
database. Because the schemas are reset, supplied-database mode also requires an exact
`BROWSER_SMOKE_DATABASE_RESET_CONFIRMATION=reset:<host>:<port>/<database>` acknowledgement;
use only a dedicated disposable database. The command drops and recreates only `yu_inventory` and
`yu_migrations`, applies committed migrations, inserts deterministic synthetic fixtures,
uses a free loopback port, and tears down the server and database schemas even after a
failure or termination signal. The production build and server receive an allowlisted process environment with
database, SSO, webhook, push and ingestion integrations explicitly disabled, so local
`.env` files cannot connect the smoke run to external services.

Playwright runs one Chromium worker with zero retries. Raw Playwright tracing is disabled
because it records cookies, headers and request bodies. A failure retains its screenshot,
safe route/status/request-ID trace and sanitized server log under
`.artifacts/browser-smoke/`; successful runs remove this directory. CI uploads the
failure directory for seven days.

The CI job is intentionally non-blocking from **2026-09-09 through 2026-09-22**. The
owner records total runs, first-attempt infrastructure failures and rerun outcomes for
that interval. It may become blocking no earlier than **2026-09-23**, only after at least
two weeks of evidence and an infrastructure rerun rate below 1%. Product failures are
never retried or reclassified as infrastructure failures. Do not add journeys until this
pilot is stable.
