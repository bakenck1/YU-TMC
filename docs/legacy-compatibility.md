# Legacy compatibility inventory

## Назначение и статус

Этот документ — реестр compatibility boundaries, которые пока нельзя удалять
по одному результату grep. Он фиксирует владельца, потребителя, security-риск,
источник usage evidence, путь миграции и измеримый sunset signal для каждого
участка. Статус всех записей на 2026-08-14 — `supported` или `import-only`;
неизвестное production usage обозначается `unknown`, а не трактуется как ноль.

Машинный baseline находится в
[`scripts/legacy-compatibility-baseline.json`](../scripts/legacy-compatibility-baseline.json),
а проверка запускается командой `npm run legacy:check`. Проверка запрещает новые
legacy permission IDs и QR formats, новые файлы старого transfer API и runtime
импорт seed/auth compatibility sources. Добавление нового исключения допустимо
только одной атомарной задачей: inventory entry, baseline, regression fixture и
обоснование owner должны попасть в один change set.

## Evidence policy

- Основной источник — агрегированные structured application/request logs с
  route/permission/format identifier, без raw QR, cookie, email, password hash,
  session token и других персональных данных.
- Для import-only участков источник — sanitized migration output и количество
  успешно обработанных fixture records; содержимое секретных файлов в отчёт не
  попадает.
- Counters хранятся минимум 90 дней. Следующий review всех записей —
  `2026-11-12`, то есть не позднее 90 дней после создания inventory.
- Если structured telemetry ещё не подключена, `evidence_status=unknown`.
  Это блокирует sunset, но не является доказательством отсутствия usage.
- Sunset decision требует owner, полные 90 дней evidence, announcement для
  пользователей/операторов и regression run на миграционных fixtures.

## Inventory

### LEGACY-PERMISSIONS

- **Owner:** Security/Auth maintainer; release owner отвечает за общий review.
- **Consumer:** `lib/security/permissions.ts`,
  `lib/security/authorization.ts`, старые users/settings routes и страницы,
  которые используют `legacy.*` IDs для сохранения существующей policy surface.
- **Tracked values:** `legacy.dashboard.read`, `legacy.items.read`,
  `legacy.locations.read`, `legacy.analytics.read`, `legacy.users.read`,
  `legacy.users.manage`, `legacy.users.manage_privileged`,
  `legacy.settings.manage`.
- **Introduced:** до выделения текущего `inventory.*` permission namespace;
  точная дата появления не восстановлена, причина — backward compatibility
  старого UI и route contract.
- **Security:** префикс `legacy.` сам по себе не даёт доступ; права задаются
  централизованной role map, а auth boundary проверяет permission на сервере.
  Переименование без alias может либо сломать старые clients, либо незаметно
  расширить доступ, поэтому cosmetic rename запрещён.
- **Evidence source:** агрегированные permission/route counters и
  `tests/role-model.test.ts`, users authorization fixtures; текущий production
  telemetry status — `unknown`.
- **Migration path:** новые endpoints используют доменные `inventory.*`
  permissions. Старые users/settings/UI routes переводятся отдельной migration
  task с dual-read/alias period, а не удалением строк из `APP_PERMISSIONS`.
- **Sunset criterion:** 90 дней нулевого usage старых IDs после migration
  announcement, green role/authorization regression run и подтверждение owner.
- **Regression:** `tests/role-model.test.ts`,
  `tests/users-collection-authorization.test.ts`,
  `tests/users-id-authorization.test.ts`, `tests/settings-toggle.test.ts`.
- **Minimum support:** не менее одного полного 90-дневного review cycle; до
  `2026-11-12` запись остаётся `supported` независимо от локального grep.

### LEGACY-TRANSFER-ROUTES

- **Owner:** Inventory responsibility maintainer; release owner контролирует
  переключение clients.
- **Consumer:** старый single-item API под `/api/inventory/transfers` и его
  UI/client callers; конкретные route files перечислены в baseline. Новый TMC
  aggregate flow живёт отдельно под `/api/inventory/transfer-requests`.
- **Tracked values:** `app/api/inventory/transfers/route.ts`,
  `app/api/inventory/transfers/[id]/cancel/route.ts`,
  `app/api/inventory/transfers/[id]/decision/route.ts`,
  `app/api/inventory/transfers/[id]/override/route.ts`.
- **Introduced:** до TMC aggregate workflow; точная дата не нужна для runtime,
  потому что старый request/decision/cancel/override contract всё ещё доступен.
- **Security:** каждый route сохраняет session proof, actor scope, CSRF,
  bounded body, CAS/version checks и hidden-object semantics. Нельзя заменить
  route redirect-ом без проверки status/body/retry compatibility.
- **Evidence source:** агрегированные request counters по route name и
  migration fixture counts; raw IDs, bodies и actor identity не сохраняются;
  production usage status — `unknown`.
- **Migration path:** новые UI workflows используют TMC transfer requests;
  старые clients получают announcement и migration guide. При необходимости
  добавляется read-only compatibility adapter, а не новая бизнес-ветка.
- **Sunset criterion:** каждый старый endpoint получает ноль production hits
  за 90 дней, опубликованный migration announcement, подтверждение владельца и
  полный route/BOLA regression run.
- **Regression:** `tests/inventory-transfer-list-route.test.ts`,
  `tests/inventory-transfer-list-bola.test.ts`,
  `tests/inventory-transfer-decision-route.test.ts`,
  `tests/inventory-transfer-cancel-route.test.ts`,
  `tests/inventory-transfer-override-route.test.ts` и их workflow/database
  suites.
- **Minimum support:** не менее 90 дней после первого documented migration
  announcement и до review `2026-11-12`.

### LEGACY-QR-ALIASES

- **Owner:** Inventory/QR maintainer.
- **Consumer:** `lib/domain/qr-identifier.ts`,
  `lib/server/seed/legacy-normalization.ts`, QR resolver/repository и уже
  напечатанные room/item labels. Formats — только `legacy_raw` и `legacy_url`.
- **Tracked values:** `legacy_raw`, `legacy_url`.
- **Introduced:** до `YUQ1:<TOKEN>` registry; причина — физические наклейки,
  старые room URLs и значения из первоначального inventory import.
- **Security:** alias — lookup identifier, не capability и не authorization.
  Resolver сохраняет exact filtered text, не выполняет URL, не раскрывает
  foreign/revoked targets и применяет role/object scope после поиска.
- **Evidence source:** агрегированные resolver format counters, длина/type
  input и versioned HMAC diagnostic key по правилам `docs/qr-format.md`, плюс
  migration fixture counts; raw codes и PII запрещены. Текущий production
  telemetry status — `unknown`.
- **Migration path:** новые labels печатаются в `YUQ1`; старые aliases не
  удаляются автоматически. После доказанного нулевого usage они могут быть
  revoked/archived отдельной audited migration, но canonical history остаётся.
- **Sunset criterion:** 90 дней без legacy resolver hits, replacement-label
  announcement, проверка revoked/ambiguous/foreign cases и подтверждение QR
  owner. До этого старый alias считается поддерживаемым.
- **Regression:** `tests/code-resolution.test.ts`,
  `tests/tmc-qr-flow.test.ts`, `tests/item-qr-page-idor.test.ts`,
  `tests/inventory-item-qr-size.test.ts`, `tests/database/tmc-operation-migration.test.ts`.
- **Minimum support:** минимум один 90-дневный physical-label migration cycle;
  не сокращать поддержку только из-за того, что seed fixture больше не меняется.

### LEGACY-AUTH-IMPORT

- **Owner:** Auth/DB migration maintainer.
- **Consumer:** `scripts/db/import-legacy-auth.ts` и
  `lib/server/persistence/legacy/legacy-credential-source.ts`; это import-only
  boundary для `auth-credentials.json` и `AUTH_ADMIN_*`.
- **Tracked values:** `scripts/db/import-legacy-auth.ts`,
  `lib/server/persistence/legacy/legacy-credential-source.ts`,
  `auth-credentials.json`, `AUTH_ADMIN_*`.
- **Introduced:** до PostgreSQL users/auth migration; причина — перенести
  существующий scrypt salt/hash и role без принудительного reset паролей.
- **Security:** credential file/env никогда не являются runtime fallback после
  DB migration; importer fail-closed на invalid shape, не логирует secret/hash,
  требует миграционный target и сохраняет idempotency.
- **Evidence source:** sanitized command result (`imported`/`already imported`)
  и migration fixture count; содержимое credential source не входит в logs.
  После миграции production usage status — `unknown`, пока не появится
  structured command telemetry.
- **Migration path:** выполнить один раз до DB-aware release, хранить backup до
  окончания soak, затем убрать source из deployment inputs. Runtime imports
  запрещены машинной проверкой.
- **Sunset criterion:** 90 дней без import runs, подтверждённый backup/restore
  exercise, отсутствие legacy source в deployment inventory и announcement.
- **Regression:** auth import tests, `tests/session-secret.test.ts`, login,
  password-reset и user authorization suites.
- **Minimum support:** importer остаётся available минимум до завершения одного
  production rollback/restore window и review `2026-11-12`; удаление раньше
  делает rollback на старую data shape невосстановимым.

### LEGACY-COOKIE-CONTRACT

- **Owner:** Auth maintainer.
- **Consumer:** signed `yu_inventory_session` cookie с payload fields
  `{sub,name,role,iat,exp,jti,ver}` в фактической реализации
  `SessionPayload`; `sub` — legacy email subject, отдельного `email` claim нет.
  Старые cookies читаются через `verifySessionToken`.
- **Tracked values:** `sub`, `name`, `role`, `iat`, `exp`, `jti`, `ver`.
- **Introduced:** до текущей session-version reauthorization; причина — не
  разлогинить пользователей при rolling release и сохранить email subject.
- **Security:** подпись/TTL/version проверяются криптографически; `sub` заново
  разрешается в PostgreSQL user, а embedded `name`/`role` — compatibility
  snapshot и не источник authorization. Deactivation/role change/session
  version invalidation применяются на secure request.
- **Evidence source:** агрегированные cookie validation outcome и session
  version mismatch counters без token/payload logging; текущий usage status —
  `unknown`.
- **Migration path:** новые cookies сохраняют тот же signed shape; поле- или
  version-changing migration сначала делает dual-read/controlled reissue,
  затем удаляет старую ветку после TTL + 90-day evidence.
- **Sunset criterion:** срок действия последнего старого cookie истёк, 90 дней
  нет old-shape validation hits, опубликовано re-login/reissue announcement и
  пройдены auth regression tests.
- **Regression:** `tests/session-secret.test.ts`, login/logout/session route,
  reset-password и session-revocation suites.
- **Minimum support:** не меньше максимального remembered-session TTL плюс один
  review cycle; текущий безопасный минимум — 30 дней TTL + 90 дней evidence.

### LEGACY-SEED-DATA

- **Owner:** Data migration maintainer.
- **Consumer:** только `scripts/db/seed.ts` импортирует `lib/data.ts`; source
  содержит development/test seed records и не должен попадать в request/runtime
  bundle. `legacy-normalization.ts` преобразует значения в текущий schema.
- **Tracked values:** `scripts/db/seed.ts`, `lib/data.ts`.
- **Introduced:** до PostgreSQL seed/migration boundary; причина — повторяемый
  локальный dataset и перенос старых inventory numbers, locations и QR values.
- **Security:** seed запрещён для production, использует явный target и
  migration/schema checks, пишет synthetic audit metadata; реальные secrets и
  production credentials в source отсутствуют.
- **Evidence source:** seed command result и counts (`users`, `items`, legacy
  QR aliases), migration fixtures; production usage status — `unknown`, потому
  что seed command intentionally blocked for production.
- **Migration path:** новые fixtures добавляются в DB-aware seed format или
  отдельные test builders. `lib/data.ts` остаётся import-only до финального
  archival of the old dataset.
- **Sunset criterion:** все development/test consumers переведены на current
  builders, fixture counts совпадают, есть archive/restore note и 90 дней нет
  seed runs кроме documented local maintenance.
- **Regression:** `tests/application-service-contracts.test.ts`, QR/seed
  normalization tests, `npm run db:seed -- --target=development` smoke path;
  production refusal остаётся обязательной проверкой.
- **Minimum support:** минимум до следующего seed format migration и review
  `2026-11-12`; удалять source вместе с единственным seed consumer нельзя без
  archived fixture replacement.

## Review procedure

Каждый quarterly review обновляет `nextReview`, evidence status и counters в
агрегированном виде. Если usage неизвестен, запись остаётся `supported`. Для
sunset owner прикладывает migration announcement, 90-дневный evidence window,
fixture/regression output и отдельную задачу удаления. `legacy:check` выполняется
в CI до тестов и не позволяет silently добавить новый compatibility surface.
