# P1 — CI и release gates

## Почему это долг

`.github/workflows/tests.yml` запускает `npm ci`, `npm run test:all`,
`npm audit`, `npm run build` и `npm run security:check`, но не запускает
`db:check`, `db:smoke`, `ui:check`, Storybook build, Compose validation и
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
   - production/mobile Compose config validation с non-secret placeholders;
   - `npm run db:migrate -- --target=test` после readiness PostgreSQL и до
     любого smoke/test шага;
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

    Целевой CI workflow должен использовать следующие явные templates (сейчас
    workflow содержит hard-coded deployment ID и потому ещё не соответствует
    этому contract; passwords берутся из ephemeral CI service, а не из
    repository secrets):

   ```text
   TEST_DATABASE_URL=postgresql://yu_inventory_test_runtime:<runtime-password>@127.0.0.1:55433/yu_inventory_test
   TEST_DATABASE_MIGRATOR_URL=postgresql://yu_inventory_test_migrator:<migrator-password>@127.0.0.1:55433/yu_inventory_test
   TEST_DATABASE_DEPLOYMENT_ID=yu-inventory-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}
   ```

    `GITHUB_RUN_ID` и `GITHUB_RUN_ATTEMPT` задаются самим workflow; текущий
    hard-coded `yu-inventory-ci-test` нужно удалить. ID не берётся из
    пользовательского ввода, не переиспользуется между runs и не совпадает с
   development/production deployment IDs. Локальные запуски обязаны задавать
   эквивалентные `TEST_DATABASE_*` variables явно.

## Подводные камни

- Не сделать Docker обязательным для каждого локального `npm run test:all`.
  Embedded/managed PostgreSQL path должен остаться доступным.
- Не подменять production credentials CI placeholders в реальном deploy job.
- `db:smoke` должен проверять именно ту БД, на которую направлен runtime URL,
  а не только успешное подключение migrator.
- Storybook build и Compose validation могут требовать больше времени, поэтому
  их лучше отделить от быстрых PR checks, но оставить обязательными для release.
- Manual gates нельзя объявлять пройденными автоматически на основании
  локального audit report.

## TDD и проверки

- Тест для `scripts/test-all.mjs` проверяет summary с database `SKIPPED`.
- CI configuration test проверяет наличие обязательных commands, fail-fast
  database environment, PostgreSQL health, создание
  `yu_inventory_test_migrator`/`yu_inventory_test_runtime`, их privilege
  separation и миграцию до smoke/test шагов.
- Smoke test проверяет runtime role grants, migrator manifest и deployment id.
- CI config test проверяет URL host/port/database, различие runtime и migrator
  user, deterministic deployment-ID template и отсутствие production URL.
- Negative test: отсутствие `TEST_DATABASE_URL` или
  `TEST_DATABASE_MIGRATOR_URL` в CI-like environment приводит к ненулевому
  exit code; наличие только одной переменной также считается ошибкой.

## Acceptance criteria

- CI падает при migration manifest mismatch.
- CI падает, если database integration не была запущена.
- CI проверяет `db:check`, `ui:check`, Storybook и security invariants.
- Compose validation не требует настоящих production secrets.
- Release checklist явно показывает automated/manual status.
- Текущие unit, UI, component и database suites остаются зелёными.

## Status: Done

Основной CI/release-контур закрыт: обязательные source/UI/database checks, lint,
мigrations, runtime smoke, полный test runner, Storybook, audit, production build
и security invariants теперь выполняются в одном workflow; database integration не
может быть незаметно пропущена.

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
