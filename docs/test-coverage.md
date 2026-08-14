# Functional test coverage matrix

This matrix records observable coverage for the critical application verticals.
It is contract-oriented: a route test proves the server boundary, a service
test proves orchestration and projection, and a PostgreSQL suite proves SQL
constraints, transaction rollback and privilege-sensitive behavior.

## Matrix

| Vertical | Evidence | Status / deliberate gap |
| --- | --- | --- |
| Auth, session and reset | [`tests/login-security.test.ts`](../tests/login-security.test.ts), [`tests/session-secret.test.ts`](../tests/session-secret.test.ts), [`tests/forgot-password-security.test.ts`](../tests/forgot-password-security.test.ts), [`tests/reset-password-route-security.test.ts`](../tests/reset-password-route-security.test.ts) | Covered for current flows; OAuth provider behavior remains a staging gate |
| Inventory item | [`tests/inventory-list-repository.test.ts`](../tests/inventory-list-repository.test.ts), [`tests/inventory-item-photo-access.test.ts`](../tests/inventory-item-photo-access.test.ts), [`tests/item-detail-page-idor.test.ts`](../tests/item-detail-page-idor.test.ts), [`tests/inventory-item-components.test.ts`](../tests/inventory-item-components.test.ts), [`tests/inventory-item-details-presentation.test.ts`](../tests/inventory-item-details-presentation.test.ts) | Covered at route/repository/presentation boundaries; large mutation orchestration stays in route/database suites |
| QR and barcode resolution | [`tests/tmc-qr-flow.test.ts`](../tests/tmc-qr-flow.test.ts), [`tests/item-qr-page-idor.test.ts`](../tests/item-qr-page-idor.test.ts), [`tests/inventory-item-qr-size.test.ts`](../tests/inventory-item-qr-size.test.ts), [`tests/application-service-contracts.test.ts`](../tests/application-service-contracts.test.ts) | Covered for privacy, revoked/out-of-scope and malformed-input contracts; hardware scanning remains staging-only |
| Buildings, rooms and workspace | [`tests/off-campus-dormitories.test.ts`](../tests/off-campus-dormitories.test.ts), [`tests/room-service-requests.test.ts`](../tests/room-service-requests.test.ts), [`tests/application-service-contracts.test.ts`](../tests/application-service-contracts.test.ts) | Direct create/update/archive mutations and projections are covered; route-level error mapping, list/find branches and browser empty/loading states remain explicit follow-up |
| Responsibility and ownership | [`tests/employee-owned-items-service.test.ts`](../tests/employee-owned-items-service.test.ts), [`tests/inventory-responsibility-repositories.test.ts`](../tests/inventory-responsibility-repositories.test.ts), [`tests/database/persistent-users.test.ts`](../tests/database/persistent-users.test.ts) | Covered where ownership changes visibility; remaining UI empty/loading states are follow-up |
| Inspections and results | [`tests/inventory-inspection-admin.test.ts`](../tests/inventory-inspection-admin.test.ts), [`tests/inventory-inspection-result-route.test.ts`](../tests/inventory-inspection-result-route.test.ts), [`tests/inventory-inspection-room-bola.test.ts`](../tests/inventory-inspection-room-bola.test.ts) | Covered for authorization and critical mutations; representative browser smoke is manual |
| Transfer and TMC | [`tests/tmc-transfer-request-service.test.ts`](../tests/tmc-transfer-request-service.test.ts), [`tests/tmc-transfer-request-route.test.ts`](../tests/tmc-transfer-request-route.test.ts), [`tests/tmc-operation-permissions.test.ts`](../tests/tmc-operation-permissions.test.ts), [`tests/database/tmc-transfer-request-transactions.test.ts`](../tests/database/tmc-transfer-request-transactions.test.ts) | Covered for service, route, permission, transaction and rollback; no duplicate unit tests for SQL invariants |
| Service requests | [`tests/service-requests-collection-bola.test.ts`](../tests/service-requests-collection-bola.test.ts), [`tests/service-request-status-route.test.ts`](../tests/service-request-status-route.test.ts), [`tests/employee-service-request.test.ts`](../tests/employee-service-request.test.ts) | Covered for collection authorization, status transitions, photos and employee UI |
| Photos and attachments | [`tests/comment-attachment-idor.test.ts`](../tests/comment-attachment-idor.test.ts), [`tests/inventory-item-photo-access.test.ts`](../tests/inventory-item-photo-access.test.ts) | Covered for access control; object-storage outage behavior is an operational gate |
| Push and outbox | [`tests/web-push-service.test.ts`](../tests/web-push-service.test.ts), [`tests/tmc-push-outbox.test.ts`](../tests/tmc-push-outbox.test.ts), [`tests/database/web-push-repositories.test.ts`](../tests/database/web-push-repositories.test.ts) | Covered for lease/retry/dead-letter and repository behavior; provider delivery is staging-only |
| Settings persistence | [`tests/settings-toggle.test.ts`](../tests/settings-toggle.test.ts) | Partial by design until task 02 replaces the file boundary with PostgreSQL persistence |
| Production monitoring | [`tests/monitor-production-errors.test.ts`](../tests/monitor-production-errors.test.ts) | Covered for separate incidents, actual source window and cleared state; alert routing is manual |
| Release/toolchain contracts | [`tests/ci-release-contract.test.ts`](../tests/ci-release-contract.test.ts), [`tests/toolchain-contract.test.ts`](../tests/toolchain-contract.test.ts), [`tests/documentation-consistency.test.ts`](../tests/documentation-consistency.test.ts) | Covered statically plus CI execution; Docker daemon is unavailable on this workstation |

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
database invariant. The runner reports server, UI, component and database
suites separately, so a skipped database suite cannot be presented as a green
full run.

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
