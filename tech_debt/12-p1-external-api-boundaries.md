# P1 — выровнять внешний API-периметр Dockflow после P0 1С

## Evidence

`lib/dockflow-api.ts` объединяет HTTP responses, API-key auth, Yessenov client,
PostgreSQL repository, большие SQL projections и DTO mapping. Он напрямую
получает pool, хотя внутренние API используют application facade. Общий bearer/
error primitive из задачи `10` можно переиспользовать, не возвращаясь к повторной
переработке 1С. После удаления DB-таблиц Dockflow key management endpoint
использует один env-secret без rotation metadata.

Dockflow `listItems` не ловит database exception, возвращает потенциально
неограниченную коллекцию и не имеет page/cursor contract. Handwritten OpenAPI на
528 строк может расходиться с runtime. Большинство тестов вызывает функции с
fake repository; SQL внешнего API не входит в PostgreSQL suite.

## Цель

Не объединять разные бизнес-интеграции. Нужен маленький общий security/HTTP
baseline и отдельные adapters для каждой интеграции.

## Минимальные шаги

### Slice A — safety contract (M)

1. Зафиксировать inventory Dockflow endpoints, owner, consumers, data classes,
   лимиты, SLA/retry и способ rotation/revocation ключа.
2. Переиспользовать один constant-time bearer verifier и один safe external
   response helper с `no-store`, request ID и allowlisted `Retry-After`.
3. Обработать unavailable dependency одинаково и не отдавать default Next HTML.
4. Добавить bounded collection contract без тихого truncate.

### Slice B — layering и contract evidence (M)

1. Вынести Dockflow SQL в PostgreSQL adapter; Yessenov join orchestration — в
   application service. Не протаскивать внутренние DTO наружу.
2. Проверить runtime role grants для integration tables/queries.
3. Генерировать OpenAPI из небольших schema fragments либо добавить contract
   tests для каждого path/status/field. Полный framework не обязателен.
4. Rotation: минимум два одновременно допустимых key slots (`current`/`next`)
   в secret store и процедура cutover; DB key-management возвращать только при
   реальной operator need.

## TDD

- auth before lookup, missing/wrong/rotated key, no secret in logs;
- stable JSON errors для dependency failure;
- pagination bounds, deterministic ordering, archived/inactive visibility;
- photo authorization, MIME/no-sniff/range policy;
- real PostgreSQL projection для individual/local group и empty data;
- OpenAPI examples проходят runtime validators.

## Подводные камни

- Не смешивать Yessenov outage с «сотрудник не найден».
- Не ломать существующих Dockflow consumers сменой envelope/status без versioning.
- Не возвращать удалённые key-management таблицы «на всякий случай».
- Не включать IIN/GUID/raw payload в operational logs.

## Acceptance

Каждый внешний endpoint имеет owner, bounded contract, safe errors, key rotation
runbook и SQL integration evidence; route не содержит persistence logic;
OpenAPI соответствует выполненному поведению.

Каждый slice — отдельный PR со своим acceptance. Оценка эффекта: **9/10** после
P0-исправления 1С; суммарный размер M–L, не один M-ticket.
