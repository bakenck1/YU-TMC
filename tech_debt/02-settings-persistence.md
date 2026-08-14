# P1 — settings persistence и multi-instance deployment

## Evidence

`lib/server/application.ts` создаёт `SettingsService(new
FileSettingsRepository())`. `docs/server-layer.md` прямо называет file adapter
временным compatibility adapter и предупреждает, что locking действует только
внутри одного процесса. `lib/server/persistence/file/file-settings-repository.ts`
использует temporary-file-plus-rename и process-local serialization.

Это не скрытый баг: граница документирована. Но при двух Next.js instances
обновления могут теряться, а разные instances могут читать разные settings.

## Цель

Получить честную гарантию для deployment model. Нужно выбрать ровно один из
вариантов и зафиксировать решение в коде и документации.

## Принятое решение — PostgreSQL adapter

Для production выбирается PostgreSQL adapter. File adapter остаётся только для
одноразового import/локального rollback window и не используется как runtime
fallback после переключения.

### Фиксированный storage contract

Добавляется singleton row в `yu_inventory.settings`:

- `id text primary key check (id = 'global')`, единственное допустимое значение
  `global`;
- `payload jsonb not null`, содержащий ровно валидный `AppSettings`;
- `version integer not null`, начиная с `1`;
- `updated_at timestamptz not null`.

Repository не отдаёт наружу database row. `get()` возвращает `AppSettings`, а
`update(patch)` в одной транзакции блокирует singleton row, читает актуальный
payload, применяет уже валидированный patch и увеличивает version. Это даёт
последовательные updates без добавления нового публичного version-поля в API.

### Migration/import contract

1. Schema migration создаёт таблицу, constraint `check (id = 'global')` и
   singleton default row через idempotent insert. Runtime role не получает
   `DELETE`/`DROP` privileges на эту таблицу; repository contract не содержит
   delete operation. Дополнительно migration создаёт `BEFORE DELETE` trigger,
   который всегда отклоняет удаление `global`; smoke test через runtime и
   migrator credentials проверяет, что row существует ровно один раз и попытка
   удаления отклоняется. Это application-table invariant, не обещание защиты
   от schema-owner/superuser, который может удалить trigger намеренно.
2. `db:import-settings -- --target=<target>` читает старый `.data/settings.json`
   только если row ещё имеет default version `1` и не была явно изменена.
3. Import валидирует `AppSettings`, пишет payload атомарно и безопасен при
   повторном запуске.
4. Missing file означает оставить defaults; corrupt file останавливает import
   без записи.
5. После успешного production soak period старый file source архивируется, но
   не удаляется без backup confirmation.

### Deployment/rollback contract

Migration применяется до нового runtime. Переключение settings reader и
writer выполняется в одном release window без смешивания старого file-writing
binary и нового DB-writing binary. Rollback идёт только на DB-aware release;
откат на старый file-only binary не считается lossless rollback и должен быть
запрещён runbook.

Soak period: минимум 7 календарных дней после production release, owner —
команда, владеющая deployment checklist; exit evidence — отсутствие settings
read/write errors и подтверждённый backup DB row.

## Реализация

1. Добавить таблицу settings с одной логической записью, `payload jsonb`,
   version и `updated_at`; JSON payload валидируется как `AppSettings` и
   согласуется с `SettingsRepository` contract.
2. Реализовать `PostgresSettingsRepository` на том же server-only boundary,
   что и остальные adapters.
3. Сохранять optimistic concurrency или атомарный SQL update, чтобы concurrent
   writes не молча перетирали друг друга.
4. Добавить одноразовый guarded import из `.data` settings:

   - missing file → documented defaults;
   - corrupt file → fail closed;
   - повторный import идемпотентен;
   - source сохраняется до успешного soak period.

5. Переключить `lib/server/application.ts` на PostgreSQL adapter после
   migration readiness. В rolling deployment сначала применить schema, затем
   новый application code.
6. Удалить file adapter из runtime только после подтверждённой миграции и
   обновить docs.

## Отложенный fallback — формально single-instance

Если PostgreSQL settings не оправданы ближайшим deployment scope:

1. Документировать, что production поддерживает ровно один writer/instance.
2. Добавить startup/deployment guard, который при наличии явно заданного
   multi-instance mode отказывается стартовать с file settings.
3. Указать, что rolling deploy и horizontal scaling несовместимы до миграции.
4. Добавить operational runbook по backup, restore и ручному recovery.

Этот вариант не закрывает архитектурный долг, а только риск неявного использования
несовместимого deployment model; задачу можно считать временно закрытой только
с принятым ограничением владельцем production.

## Подводные камни

- Нельзя просто заменить repository без migration ordering.
- Нельзя делать fallback на file после ошибки PostgreSQL: это создаст два
  источника истины.
- Нельзя считать process-local lock защитой между workers/containers.
- Read-after-write должен быть проверен через разные database connections.
- При rolling deploy старый код не должен ломаться из-за новой таблицы.

## TDD и acceptance

- repository contract tests для defaults, update, malformed data и versioning;
- two-process/connections test на concurrent updates;
- migration test с повторным запуском import;
- read-after-write test через отдельные pool clients;
- deployment test подтверждает выбранную модель;
- при варианте B multi-instance startup test завершается понятной ошибкой.

## Status: Done

Есть принятое deployment решение, отсутствует неявный multi-instance data loss,
миграция/rollback документированы, а test suite доказывает выбранную гарантию.

### Что поставлено в коде

- `yu_inventory.settings` стал singleton-таблицей с `global`-ключом, JSONB
  payload, версией, временем изменения, default row и защитным delete trigger;
- `PostgresSettingsRepository` читает и обновляет settings через PostgreSQL,
  блокирует строку `FOR UPDATE`, увеличивает версию и не использует file
  adapter как runtime fallback; ошибки подключения и повреждённые строки
  превращаются в стабильный `settings_unavailable`;
- `db:import-settings` выполняет одноразовый guarded import старого
  `.data/settings.json`, поддерживает явный `--source`, fail-closed для
  повреждённого/невалидного файла и безопасен при повторном запуске;
- production Compose выполняет migration → import → smoke и монтирует только
  `./.settings-import`; mobile и оба режима `npm run dev` выполняют ту же
  подготовку до запуска приложения;
- runtime/migrator privileges, reset/smoke checks, release checklist, database
  runbook и test-coverage documentation синхронизированы с контрактом.

### Доказательства и review

- `npm.cmd run test:all`: 548 server, 15 UI и 41 component tests;
- `npm.cmd run test:database:local`: все локальные PostgreSQL suites, включая
  4 settings integration tests;
- focused settings/release tests: 16/16; `lint`, `docs:check`, `ui:check`,
  `db:check`, `security:check`, `build`, Compose config и `git diff --check` —
  green;
- первый независимый review: 7/10 (tests 8/10); исправлены production import,
  strict payload guard, нормализация ошибок repository и regression coverage;
- второй независимый review: 7/10 (tests 8/10); исправлены production smoke,
  внешний `DATABASE_URL` dev startup и отдельный mobile import mount. По
  договорённости выполнено два review-прохода, третий не запускается.

### Оставленные осознанные границы

- schema owner/superuser всё ещё может намеренно удалить trigger/table или
  обойти прикладную защиту — это не полномочие runtime роли;
- JSON shape валидируется application layer, а не отдельной JSON Schema в БД;
- два одновременных изменения одного и того же поля имеют last-writer-wins;
  row lock не делает API optimistic-CAS без отдельного expected version;
- семидневный production soak, backup и archive legacy source остаются
  операционным release gate и требуют фактического выполнения;
- реальная сборка Docker image не запускалась локально: Docker daemon
  недоступен, проверен только `docker compose ... config --quiet`.
