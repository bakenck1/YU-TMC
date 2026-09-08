# Functional test coverage matrix

This matrix records observable coverage for the critical application verticals.
It is contract-oriented: a route test proves the server boundary, a service
test proves orchestration and projection, and a PostgreSQL suite proves SQL
constraints, transaction rollback and privilege-sensitive behavior.

## Matrix

Уровни: **R** — выполненный route/HTTP boundary, **A** — application/service,
**P** — реальный PostgreSQL/runtime-role, **C** — component interaction,
**B** — browser. «—» означает осознанный gap, а не покрытие соседним grep-тестом.

| Production vertical | Критичный invariant | R | A | P | C | B / честный gap |
| --- | --- | :---: | :---: | :---: | :---: | --- |
| Auth/session/reset/OAuth | origin, token binding, revocation, no account takeover | ✓ | ✓ | ✓ | — | OAuth-provider staging gate |
| Users/provisioning | live role/session, active/deleted visibility, concurrent first login | ✓ | ✓ | ✓ | ✓ | — |
| Inventory items/import/export/analytics | validation, scope, atomic mutations, bounded datasets | ✓ | ✓ | ✓ | ✓ | file download/import browser journey остаётся gap |
| Buildings/rooms/workspace | authorization, normalization, QR/audit atomicity | частично | ✓ | ✓ | ✓ | empty/loading browser states — gap |
| QR/barcode resolution | namespace, revoked/out-of-scope masking, malformed input | ✓ | ✓ | ✓ | ✓ | hardware camera — staging gate |
| Responsibility/ownership | exact active period, visibility and atomic reassignment | ✓ | ✓ | ✓ | ✓ | — |
| Inspections/results | admin authorization, BOLA, result persistence | ✓ | ✓ | ✓ | ✓ | representative browser smoke — task 22 |
| TMC transfer requests | participant BOLA, idempotency, rollback and races | ✓ | ✓ | ✓ | ✓ | journey smoke — task 22 |
| Local barcodes/groups | shared namespace, quantity bound, append-only lifecycle | ✓ | ✓ | ✓ | ✓ | printer/device staging gate |
| Decommissioned-in-use | lifecycle visibility and nullable responsibility | ✓ | ✓ | ✓ | ✓ | — |
| Service requests | collection BOLA, required photo, status transition | ✓ | ✓ | ✓ | ✓ | — |
| Photos/attachments | parent scope, MIME/size, lifecycle and byte serving | ✓ | ✓ | ✓ | ✓ | object-store outage is operational |
| Asset loss (P0) | actor/BOLA, body bounds, exact period, receipt rollback/race | ✓ | ✓ | ✓ | n/a | API-only by recorded decision |
| 1C fixed-assets inbox (P0) | auth-before-body, 10 MiB/deadline, lease, atomic upsert | ✓ | ✓ | ✓ | n/a | external consumer staging gate |
| Dockflow external API | key rotation, bounded cursor, safe errors, public projection | ✓ | ✓ | ✓ | n/a | external consumer staging gate |
| Push/outbox | lease, retry/dead-letter, ownership and stale cleanup | ✓ | ✓ | ✓ | ✓ | provider delivery staging gate |
| Settings | singleton, guarded import, locking/concurrency | ✓ | ✓ | ✓ | ✓ | — |
| Monitoring/release/toolchain | incident window and fail-closed release gates | n/a | ✓ | n/a | n/a | production routing/restore/load gates — task 23 |

Ключевые behavioral evidence: asset-loss —
[route](../tests/asset-loss-route.test.ts),
[application](../tests/asset-loss-service.test.ts),
[PostgreSQL](../tests/database/asset-loss.test.ts) и
[upgrade](../tests/database/asset-loss-upgrade.test.ts); 1С —
[HTTP/application](../tests/one-c-fixed-assets.test.ts) и
[PostgreSQL](../tests/database/one-c-fixed-assets.test.ts); Dockflow —
[HTTP/application/OpenAPI](../tests/dockflow-test-api.test.ts) и
[PostgreSQL runtime role](../tests/database/dockflow-api.test.ts); local barcode —
[service/route](../tests/local-barcode.test.ts) и
[PostgreSQL](../tests/database/local-barcodes.test.ts); decommissioned-in-use —
[service/presentation](../tests/decommissioned-items-service.test.ts) и связанные
inventory PostgreSQL suites.

Source-based architecture assertions для asset-loss, 1С, Dockflow, attachment,
transfer и collection boundaries больше не являются единственным доказательством:
рядом выполняются handlers/services, а SQL/rollback/race проверяются отдельным
PostgreSQL-процессом. Browser coverage намеренно не приписывается этой задаче.

## Direct service seams added by this task

[`tests/application-service-contracts.test.ts`](../tests/application-service-contracts.test.ts)
uses in-memory ports only where the observable contract is orchestration or DTO
projection. It covers:

- idempotent command completion, replay, in-progress and reused-key failures;
- QR responsible-name privacy, revoked/out-of-scope masking and malformed input;
- room public, limited and full projections;
- location normalization, QR/audit creation, version conflicts, authorization
  and archive guards.

The file is not intended to duplicate every service method. Database invariants
and rollback remain in PostgreSQL suites; route authorization remains at the
server boundary.

## TDD rule for new work

For a new mutation or regression, add the smallest failing test at the boundary
where the guarantee is observable, then implement the minimum change:

1. validation and error mapping at the route/service boundary;
2. authorization and privacy projection at the service/route boundary;
3. concurrency, rollback and SQL constraints in the PostgreSQL suite;
4. loading, empty, error and retry behavior in a focused component test.

Do not introduce a coverage percentage gate. The required gate is one contract
test for every critical mutation and one integration assertion for every
database invariant. The runner reports the `unit-route`, `ui`, `component` and
`postgresql` lanes separately, so a locally skipped PostgreSQL lane cannot be
presented as a green full run in CI.

## Commands

```text
npm run test:all
npm run test:database:local
npm run lint
npm run ui:check
```

`npm run test:all` is the fast default. PostgreSQL guarantees require
`TEST_DATABASE_URL` and `TEST_DATABASE_MIGRATOR_URL`; CI supplies both roles
and fails closed when either is absent.
