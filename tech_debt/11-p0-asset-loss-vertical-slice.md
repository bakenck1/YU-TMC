# P0 — выровнять asset-loss как полноценный vertical slice

## Корень долга

Финансово значимый workflow утраты имущества реализован одним
`lib/server/asset-loss-service.ts`, который одновременно валидирует домен,
авторизует пользователя, открывает транзакции, выполняет raw SQL, хранит фото и
строит DTO. Для него не найдено ни одного теста в `tests/`, хотя routes и таблицы
доступны production build. UI-компонента и UI-callsite для этих endpoints нет,
поэтому пока не доказано, что это API-only feature, недоставленный UI или
неиспользуемая заготовка.

## Разблокирующее решение — до реализации

Owner за один короткий discovery фиксирует один вариант:

1. **Workflow нужен сейчас:** закрыть backend safety slice ниже; UI оформить
   отдельной продуктовой задачей только при подтверждённом consumer journey.
2. **API-only:** назвать consumer и контракт, удалить component acceptance.
3. **Функция не запущена:** отключить mutation routes, сохранить данные/schema и
   подготовить отдельный reversible cleanup. Не строить новые слои вокруг неё.

До этого решения допускаются только tests, которые воспроизводят найденные
backend-инварианты, и fail-closed отключение endpoint.

## Риски и неоднозначности

- прямой `getDatabasePool()` нарушает принятую цепочку application service ->
  repository port -> PostgreSQL adapter и дублирует retry/rollback rules;
- ручные BEGIN/COMMIT не используют `PostgresUnitOfWork` и serializable retry;
- route не проверяет UUID и allowlist полей последовательно;
- approve закрывает case даже если `UPDATE responsibility_periods` изменил 0
  строк после смены ответственного; бизнес-инвариант сейчас не определён;
- повторная квитанция после rejection создаёт новое attached photo, но старое
  фото не переводится в superseded/removed, создавая orphaned binary data;
- список молча ограничен 200 строками без cursor/overflow signal;
- event table не имеет явно проверенного append-only/state-chain contract;
- permission route и role check service используют разные понятия доступа;
- отсутствуют idempotency/retry expectations для create/upload/review;
- нет записи в coverage matrix; UI tests пока неприменимы без UI consumer.

## Сначала продуктовые решения

До кода зафиксировать: кто создаёт case за сотрудника; что происходит, если
ответственность изменилась; должен ли approved case менять lifecycle предмета;
можно ли повторно отправлять квитанцию; кто и сколько хранит старые фото. Если
ответа нет, безопасный default — conflict без изменения case/item.

## Минимальная реализация

1. Вынести contracts/normalization в application layer, SQL — в asset-loss
   repository adapter, транзакции — в общий UnitOfWork.
2. Оставить один service, не дробить на command bus/aggregate framework.
3. Связать transition с ожидаемым status/version и проверять affected row count.
4. На approval повторно блокировать item, responsibility, employee и case;
   откатывать всё при несовпадении snapshot.
5. Замену receipt выполнять одной транзакцией с lifecycle старого photo.
6. Добавить cursor либо fail-closed overflow вместо тихого `LIMIT 200`.
7. Унифицировать hidden-object semantics и safe error responses.

## TDD-порядок

- service: happy paths всех переходов, invalid transition, actor revoked/
  demoted, чужой case, admin-on-behalf, amount/comment validation;
- route: auth/CSRF, UUID, unknown fields, bounded JSON/photo, safe errors/cache;
- PostgreSQL: open-case uniqueness, concurrent create/review, responsibility
  changed during review, full rollback, photo replacement lifecycle, event chain;
- если отдельно подтверждён UI scope: loading/empty/error/retry, upload
  rejection, stale conflict и role-dependent actions;
- migration test: fresh DB и upgrade path сохраняют ограничения.

## Подводные камни

- Финансовый amount не считать через JS float; оставить decimal string/numeric.
- Не ослаблять photo constraints ради повторной загрузки.
- Не закрывать ответственность и case разными транзакциями.
- Не добавлять hard delete; финансовые события должны сохранять audit trail.

## Acceptance

Зафиксирован owner/consumer и go/no-go. Для активного backend каждый transition
доказан на service/route/real PostgreSQL; race не создаёт
двойной case и не закрывает неверную ответственность; старые receipts имеют
явный lifecycle; ни один SQL/driver detail не попадает клиенту; coverage matrix
содержит vertical.

Оценка эффекта: **10/10**. Выполнять сразу после 1С.
