# Аудит безопасности перед production — 2026-08-10

## Вердикт

Текущий код этапа 4 проходит локальные unit, UI, security, PostgreSQL integration и
production build проверки. Выпуск остаётся **NO-GO**, пока не закрыты перечисленные
ниже P0-ворота. Автоматические проверки существенно снижают риск, но не доказывают
отсутствие всех уязвимостей и не заменяют проверку production-конфигурации и внешнее
тестирование работающего стенда.

Аудит ориентирован на наиболее опасные для API классы: object-level и
function-level authorization, изоляцию уведомлений, CSRF, повтор запросов,
конкурентные изменения и утечки через ошибки. Базовые критерии сверены с
[OWASP API1:2023 BOLA](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/),
[OWASP API5:2023 BFLA](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/)
и рекомендациями [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security).

## Проверенный контур

- серверная авторизация истории, карточки заявки, фото и уведомлений;
- актуализация роли внутри транзакции, admin override и скрытие BOLA как `404`;
- same-origin boundary для cookie-authenticated mutations, строгие JSON-схемы,
  allowlist query-параметров, запрет parameter pollution и лимиты тела/выборки;
- идемпотентные создание, решение и отмена, CAS версий и конфликтующие операции;
- append-only audit, mailbox sequence, read receipt и isolation admin queue;
- миграция PostgreSQL, ограничения, triggers, транзакции и конкурентные сценарии;
- CSP с nonce, HSTS, frame denial, MIME sniffing protection и `no-store` для
  приватных API;
- поиск опасных HTML/eval-конструкций и секретов, аудит production-зависимостей;
- RU/KZ/EN UI, mobile/desktop responsive component tests и production build.

## Найдено и исправлено

### S4-01 — High — разрыв доступа прежнего владельца

Сводное уведомление прежнему ответственному вело на заявку, которую он не мог
открыть, если администратор был инициатором. Прежний владелец теперь считается
участником по неизменяемому snapshot `currentResponsibleIdAtRequest` и допускается
к карточке, фото и истории; посторонний пользователь по-прежнему получает скрытый
`404`. Scope истории реализован SQL `EXISTS`, поэтому фильтрация выполняется в БД,
а не после выборки.

### S4-02 — Medium — завершённые заявки считались просроченными

DTO вычислял просрочку только по времени, хотя SQL-фильтр считал просроченными
только ожидающие заявки. Теперь признак равен `true` только для `pending` на
дедлайне или после него. Добавлены регрессии для закрытой заявки и точной границы
срока.

### S4-03 — High — несовместимость trigger после расширения типов событий

Реальная миграция PostgreSQL выявила, что старые функции целостности не принимали
новые `cancelled`/`problem` события. Forward migration обновляет обе trigger-функции,
а integration-тесты доказывают защиту связанного события от подмены типа или
subject.

### S4-04 — Medium — смешение причин административных действий в UI

Причина административного решения и причина административной отмены разделены.
Обычный инициатор может отменить свою заявку без искусственного admin-reason;
администратор при отмене чужой заявки обязан указать причину, как требует сервер.

### S4-05 — High — Web Push был неполным и недолговечным

Первоначально только новая заявка отправлялась через post-response callback, а
результат, отмена, проблема и просрочка оставались только во внутрисистемном
mailbox. Теперь все пять событий атомарно ставятся в PostgreSQL outbox. Отдельный
worker арендует due-события через `FOR UPDATE SKIP LOCKED`, повторяет временные
ошибки с backoff, помечает десятую неудачу dead-letter, удаляет устаревшие
subscriptions и использует стабильный event tag/topic. Администраторы разрешаются
на момент доставки, а закрытая заявка повторно исключается перед overdue push.
Worker добавлен в production/mobile Compose; route `after()` только ускоряет
доставку и не является её гарантией.

### S4-06 — High — история не показывала смену локации

История заявок дополнена операциями `item.location_changed`: старое/новое
помещение, actor, время и комментарий. Для сотрудника SQL проверяет его период
ответственности именно на момент audit-события; администратор видит полный поток.

### S4-07 — Medium — неполный audit и повтор отмены

Audit каждой позиции теперь содержит `requestId` и `requestItemId`, родительские
записи — comment/admin reason. Отмена аудирует только реально перешедшие из
`pending` позиции. UI сохраняет один idempotency key после потерянного ответа, а
admin-cancel отдельно уведомляет инициатора.

### S4-08 — High/Medium — race, duplicate delivery и неполная история

Outbox теперь повторно проверяет `pending`/expiry внутри atomic claim и перед
резервированием каждой subscription; отмена в той же транзакции помечает overdue
как недоставляемый. Успех каждой пары event/subscription хранится отдельно, поэтому
повтор события не отправляет уже доставленные targets. История получила независимые
opaque cursor для заявок и смен локации. Сводка результата отображается как
«Принято N из M» во внутрисистемном и Web Push каналах. Outbox и delivery-attempts
добавлены в канонический Drizzle schema и snapshot миграции.

## P0 — блокирует production

1. **Провести ручную матрицу на физических устройствах:** Android Chrome/PWA,
   iOS Safari/PWA и минимум два desktop-браузера. Проверить запрос разрешения,
   background push, deep link, повторный вход другим пользователем на том же
   устройстве, unread/read, отмену, частичный результат и 50 ТМЦ.
2. **Проверить production/staging конфигурацию:** уникальные `SESSION_SECRET` и
   VAPID private key из secret manager, точный public origin, HTTPS и trusted proxy,
   least-privilege DB role, отсутствие dev fallback, применимость миграции к копии
   production и успешное восстановление backup. Секреты не должны попадать в логи
   или образ.
3. **Выполнить внешний authenticated DAST/pentest на staging** под employee,
   warehouse и admin: перебор UUID, горизонтальная/вертикальная авторизация,
   cookie/CSRF, request smuggling на ingress, лимиты, upload/Excel/QR endpoints и
   сценарии смены роли/пользователя. Исправить все Critical/High до выпуска.

## P1 — закрыть до массового rollout

1. Добавить alerting по ошибкам outbox/Web Push, росту dead-letter, конфликтам CAS,
   rate-limit spikes, `5xx` и ошибкам миграции; исключить PII и payload из логов.
2. Провести нагрузочный тест истории/уведомлений и пачки из 50 ТМЦ с production-like
   объёмом данных; проверить индексы через `EXPLAIN (ANALYZE, BUFFERS)`.
3. Зафиксировать runbook: rollback приложения, roll-forward миграции, отключение
   push worker, отзыв сессий, ротация VAPID/session secrets и incident contacts.

## P2 — последующее усиление

1. Добавить property/fuzz tests для JSON/query parsers и state-machine заявок.
2. Автоматизировать browser E2E матрицу и accessibility checks в CI.
3. Включить регулярное dependency/container scanning и периодический повторный
   pentest после изменений auth, импорта или уведомлений.

## Доказательства проверки

- `npm run test:all`: 366 server tests, 15 source/UI tests и 24 component tests;
- `npm run test:database:local`: 8 persistent-user, 1 migration, 4 repository,
  3 transaction/concurrency и 1 Web Push integration suite;
- `npm run build`: production Next.js 16.2.11 build успешен;
- `npm run db:check`: Drizzle schema, journal и snapshots согласованы;
- `npm run lint -- --quiet`: успешно;
- `npm run security:check`: security invariants verified;
- `npm audit --omit=dev`: 0 известных уязвимостей;
- `git diff --check`: ошибок whitespace нет.

Физическая browser/device матрица, production secrets/ingress/backup и внешний
staging pentest в локальной среде не проверены. До их выполнения нельзя давать
гарантию «уязвимостей нет» или брать production-риск как закрытый.

Compose-конфигурации worker валидны, one-shot worker smoke успешен. Сборка Docker
worker image локально не выполнена, потому что Docker Desktop daemon не был запущен;
её необходимо выполнить в CI/staging как часть P0 configuration gate.
