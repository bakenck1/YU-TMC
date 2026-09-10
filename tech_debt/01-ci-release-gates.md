# P1 — CI и release gates

## Почему это долг

На момент постановки задачи `.github/workflows/tests.yml` запускал `npm ci`,
`npm run test:all`, `npm audit`, `npm run build` и `npm run security:check`, но не запускал
`db:check`, `db:smoke`, `ui:check`, Storybook build, deployment guard smoke и
отдельный migration/runtime-role smoke-test. При этом `scripts/test-all.mjs`
может намеренно пропустить PostgreSQL integration вне CI, если
`TEST_DATABASE_URL` не задан.

`docs/security-audit-2026-08-14.md` дополнительно оставляет NO-GO до ручных
проверок production secrets, DB roles, TLS/ingress, backup/restore, staging
DAST, image scan, load и rollback. Сейчас automated CI и manual release
checklist не представлены как единый контракт.

## Цель

Сделать так, чтобы зелёный CI доказывал весь автоматизируемый критический
контур, а оставшиеся внешние проверки были видны как обязательные manual gates,
а не терялись в audit-документе.

## Минимальная реализация

1. Добавить отдельный `release-validation` job либо расширить существующий job
   с шагами:

   - `npm run db:check`;
   - `npm run ui:check`;
   - `npm run storybook:build`;
   - изолированный smoke backup/HTTPS guards текущего direct deployment без
     production credentials (`scripts/test-deployment-runtime.sh`), syntax
     checks для HTTPS/backup scripts и статические contract checks systemd units;
   - `npm run db:migrate -- --target=test` после readiness PostgreSQL и до
     любого database smoke/test шага;
   - `npm run db:smoke -- --target=test` через isolated test deployment id;
   - `npm run test:all` с обязательными `TEST_DATABASE_URL` и
     `TEST_DATABASE_MIGRATOR_URL`;
   - `npm run build` и `npm run security:check`;
   - `git diff --check` или эквивалентная whitespace-проверка.

2. Добавить отдельный script, например `release:check`, если длинный список
   шагов сложно поддерживать в YAML. Script должен возвращать non-zero при
   любой пропущенной проверке и печатать фактический scope.

3. Изменить `scripts/test-all.mjs` так, чтобы:

   - в CI отсутствие `TEST_DATABASE_URL` уже приводило к ошибке;
   - локальный запуск явно печатал `PostgreSQL integration: SKIPPED` и
     команду, которая нужна для запуска;
   - итоговый summary показывал unit/UI/component/database suites отдельно;
   - не было ложного сообщения «all tests passed», если database suite не
     выполнялась.

4. Добавить `docs/release-checklist.md` с двумя блоками:

   - автоматические gates, которые выполняет CI;
   - ручные gates перед production: secrets, DB roles, TLS, trusted proxy,
     backups/restore, staging browser/PWA/OAuth/password reset/push, DAST,
     image scan, load/EXPLAIN, rollback и graceful shutdown.

5. Зафиксировать порядок database steps:

   `PostgreSQL health/roles → db:check → db:migrate --target=test →
   db:smoke --target=test → test:all → build/security checks`.

   В CI database service создаётся заново на каждый job; cleanup выполняется
   уничтожением service/database, а не shared production state. Не запускать
   production migration в обычном CI.

6. Зафиксировать role contract для test smoke:

   - `yu_inventory_test_migrator` — отдельный login/schema-owner role; только
     он применяет migrations, видит `yu_migrations.__drizzle_migrations` и
     изменяет schema objects;
   - `yu_inventory_test_runtime` — отдельный login role приложения; ему
     разрешены schema `USAGE`, application tables `SELECT/INSERT/UPDATE` и
     sequence `USAGE/SELECT`, но запрещены `CREATE`, `DROP`, миграционные
     history writes, hard-delete privilege и права schema owner;
   - оба role подключаются к одной test database, но через разные URLs; CI
     должен явно применить runtime grants после migration либо проверить, что
     migration runner применил их, а не считать простое `CREATE ROLE` достаточным;
   - CI сначала создаёт migrator/database, затем runtime role, затем запускает
     migration через migrator URL и smoke/runtime tests через runtime URL;
   - deployment id проверяется через обе credentials и обязан отличаться от
     любого non-test deployment id.

    Реализованный CI workflow использует следующие явные templates; passwords
    берутся из ephemeral CI service, а не из repository secrets:

   ```text
   TEST_DATABASE_URL=postgresql://yu_inventory_test_runtime:<runtime-password>@127.0.0.1:55433/yu_inventory_test
   TEST_DATABASE_MIGRATOR_URL=postgresql://yu_inventory_test_migrator:<migrator-password>@127.0.0.1:55433/yu_inventory_test
   TEST_DATABASE_DEPLOYMENT_ID=yu-inventory-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}
   ```

    `GITHUB_RUN_ID` и `GITHUB_RUN_ATTEMPT` задаются самим workflow. ID не берётся
    из пользовательского ввода, не переиспользуется между runs и не совпадает с
    development/production deployment IDs. Локальные запуски обязаны задавать
    эквивалентные `TEST_DATABASE_*` variables явно.

## Подводные камни

- Не делать дополнительную инфраструктуру обязательной для каждого локального `npm run test:all`.
  Embedded/managed PostgreSQL path должен остаться доступным.
- Не подменять production credentials CI placeholders в реальном deploy job.
- `db:smoke` должен проверять именно ту БД, на которую направлен runtime URL,
  а не только успешное подключение migrator.
- Storybook build и deployment smoke могут требовать больше времени, поэтому
  их лучше отделить от быстрых PR checks, но оставить обязательными для release.
- Manual gates нельзя объявлять пройденными автоматически на основании
  локального audit report.

## TDD и проверки

- Contract test статически проверяет обязательные commands, deterministic
  deployment-ID template, wiring deployment smoke и порядок
  `db:migrate → db:smoke → test:all`.
- Source contract `scripts/test-all.mjs` проверяет парность database URLs,
  обязательность PostgreSQL в CI и отдельный `SKIPPED` summary локально.
- Сам workflow поднимает health-checked PostgreSQL, создаёт две restricted роли
  и исполняет migration, runtime smoke и PostgreSQL tests. Эти свойства
  подтверждаются выполнением CI, а не выдаются за локально симулированные
  negative behavioral tests.

## Acceptance criteria

- CI падает при migration manifest mismatch.
- CI падает, если database integration не была запущена.
- CI проверяет `db:check`, `ui:check`, Storybook и security invariants.
- Direct deployment checks не требуют настоящих production secrets: isolated
  smoke проверяет schema/deployment-ID mismatch, backup и Nginx activation/
  rollback, а contract tests — systemd units и порядок migration/start steps.
- Release checklist явно показывает automated/manual status.
- Текущие unit, UI, component и database suites остаются зелёными.

## Status: Done

Основной CI/release-контур закрыт: обязательные source/UI/database checks, lint,
мigrations, runtime smoke, полный test runner, Storybook, audit, production build
и security invariants теперь выполняются в одном workflow; database integration не
может быть незаметно пропущена.

После принятого отказа от container runtime прежний Compose-критерий удалён из
актуального acceptance. Для текущего tracked deployment contract CI запускает
`scripts/test-deployment-runtime.sh`: его изолированный fake-command harness
проверяет backup, schema/deployment-ID mismatch и Nginx activation/rollback.
Отдельные contract tests проверяют systemd unit definitions и документированный
порядок migration/start, но не объявляются runtime-запуском этих services.

Validation: `npm.cmd run docs:check`, CI contract tests, `npm.cmd run lint`,
`npm.cmd run db:check`, `git diff --check` и `npm.cmd run test:all` проходят.
Локальный `test:all` явно сообщает, что PostgreSQL suite skipped без credentials;
полный DB прогон остаётся CI gate.

Independent review: первый проход — 5/10, test quality 4/10; после корректирующего
прохода — 7/10, test quality 6/10. Оставшиеся замечания относятся к отдельным
следующим задачам и не скрыты: локальный embedded-PostgreSQL runner пока создаёт
superuser migrator, а контрактные тесты workflow остаются текстовыми. Их не
маскируем статусом этой задачи; они будут закрыты вместе с воспроизводимостью
toolchain/DB и усилением test-contract coverage.

Reconciliation после удаления container runtime прошёл два fresh review без
контекста: **7/10**, затем **7.8/10** (evidence/test **7/10** и **8.2/10**).
После второго score исправлены все три actionable замечания: historical/current
формулировки разделены, deployment smoke не приравнивается к запуску systemd
services, а TDD-раздел описывает фактические static/runtime evidence boundaries.
Третий review не запускался согласно лимиту в два прохода.
