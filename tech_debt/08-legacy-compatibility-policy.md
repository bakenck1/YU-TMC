# P3 — policy для legacy compatibility

## Что намеренно не удаляем сейчас

Legacy QR aliases/URLs, credential import, cookie compatibility claims и
legacy transfer routes описаны как действующие compatibility boundaries.
Удаление без usage evidence может сломать старые наклейки, cookies, импорт или
существующих клиентов.

## Что нужно сделать

Создать compatibility inventory для `legacy.*` permissions, legacy transfer
routes, QR `legacy_raw`/`legacy_url` aliases, legacy credential importer,
старого cookie `{sub,email,name,role,...}` contract и `lib/data.ts` legacy seed
source.

Для каждого entry зафиксировать owner и consumer, дату/причину появления,
security implications, production usage evidence, migration path, критерий
удаления, regression fixture и минимальный срок поддержки.

### Evidence и ownership contract

Owner по умолчанию — maintainer соответствующего домена; release owner
сводит inventory в `docs/legacy-compatibility.md`. Usage evidence берётся из
structured application/request logs и миграционных fixture counts, без записи
секретов и персональных данных. Retention для агрегированных usage counters —
90 дней; если structured telemetry отсутствует, entry помечается `unknown`, а
не объявляется неиспользуемым. Каждая запись получает следующую дату review не
позднее 90 дней после создания.

Sunset decision требует owner, production evidence за 90 дней, migration
announcement и regression run. Если evidence неполно, статус остаётся
`supported`, а compatibility code не удаляется.

## Правила

1. Новые APIs не добавляют `legacy.*`, если ресурс можно назвать текущим
   доменным именем.
2. Existing legacy fixtures продолжают проходить.
3. Compatibility code должен быть import-only/read-only там, где это возможно.
4. Sunset начинается только после telemetry/production inventory и migration
   announcement.
5. Renaming permission без compatibility alias — отдельная migration task, не
   часть cosmetic cleanup.

## Acceptance

Есть inventory, owner, источник evidence, 90-дневная retention/review policy;
новые legacy usages запрещены проверкой или documented exception; QR/auth/
transfer regression tests зелёные; для удаления каждого участка есть
измеримый signal и migration announcement.

## Status: Done

### Что поставлено

- Создан подробный реестр [`docs/legacy-compatibility.md`](../docs/legacy-compatibility.md)
  для шести boundaries: `legacy.*` permissions, старые transfer routes,
  `legacy_raw`/`legacy_url` QR aliases, auth importer, signed cookie contract и
  `lib/data.ts` seed source.
- Добавлен machine-readable baseline
  [`scripts/legacy-compatibility-baseline.json`](../scripts/legacy-compatibility-baseline.json)
  с owner-facing inventory IDs, canonical values, route allowlist, review date и
  90-дневным evidence retention.
- `npm run legacy:check` встроен в README, documentation checker, CI и root test
  suite. Он проверяет fields внутри каждой inventory section, связывает baseline
  values с документацией, блокирует overdue review, неизвестные legacy
  permissions/QR formats, новые transfer route files и runtime imports старого
  seed/auth источника.
- Проверка сверяет QR allowlist с canonical `QR_FORMATS` registry, точный
  `SessionPayload` field set и прямой доступ к `AUTH_ADMIN_*`/
  `auth-credentials.json`; side-effect, dynamic, `require` и root-level source
  imports тоже покрыты.
- Добавлены negative fixtures, доказывающие отказ для нового permission,
  baseline-only undocumented exception, нового QR format, dynamic/side-effect
  seed import, прямого credential access, лишнего cookie claim и просроченного
  review date. Existing QR/auth/transfer regression suite не менялся по смыслу.

### Validation and independent review

- `npm.cmd run test:all`: 550 server, 15 UI и 41 component tests;
  PostgreSQL integration в этом task не затрагивался и runner сообщил `SKIPPED`
  без paired test credentials.
- `npm.cmd run legacy:check`, `docs:check`, `lint`, `ui:check`, `security:check`,
  `db:check`, `build` и `git diff --check` прошли.
- Первый fresh review: 6/10, tests 7/10. Исправлены baseline bypass, QR
  false-negative, overdue review, global-only field checks, import detection,
  cookie drift и отсутствие behavioral fixtures.
- Второй и последний fresh review: 6/10, tests 7/10. Его дополнительные
  замечания по side-effect/root imports, прямому credential access и лишним
  cookie claims исправлены финальным hardening pass; третий review не запускается
  по ограничению в два прохода.

### Осознанные границы

- Production usage counters пока `unknown`: telemetry policy и retention
  зафиксированы, но фактическое подключение structured production collector —
  отдельная operational задача.
- Static gate покрывает application source/config roots и canonical registries;
  SQL/генерируемый код с новым смыслом должен одновременно обновить inventory,
  baseline и regression fixture. Это policy gate, а не полноценный AST/security
  analyzer.
- `loop-code-review-skill/` — заранее существующий untracked каталог, в task
  commit не включён.
