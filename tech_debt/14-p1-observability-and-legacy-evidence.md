# P1 — structured observability и evidence для legacy sunset

## Корень долга

Monitoring script агрегирует существующие строки, но приложение не задаёт единый
structured event contract. Поэтому usage шести compatibility paths остаётся `unknown`,
а удалить их безопасно нельзя. Эта задача не включает внешние release-проверки и
настройку инфраструктурных alert-каналов — они вынесены в задачу 23.

## Slice A — безопасный event envelope (M)

Owner: maintainer серверной платформы.

1. Ввести JSON envelope: timestamp, level, event, requestId, route, status, duration,
   deploymentId и стабильный safe error code.
2. Первичный sink — stdout/systemd journal, который уже читает monitoring script;
   новый SaaS/collector не вводить.
3. На ingress доверять forwarded request ID только по утверждённой proxy policy,
   иначе генерировать серверный ID; возвращать его в safe error response.
4. Сначала покрыть external APIs, auth, asset-loss, unexpected 5xx и TMC worker.
5. Allowlist/redaction обязана исключать cookie, Authorization, XML/body, email, IIN,
   ФИО, photo bytes/data URL и вложенные `cause/details`.

Проверки: redaction fixtures; forged forwarding header; expected 4xx не становится
error event, unexpected exception становится; monitoring parser читает JSON и старые
journal lines. Готово, когда 5xx/worker failure коррелируется с deployment/request без PII.

## Slice B — агрегированные legacy counters (S–M)

Зависит от Slice A. Owner: владелец соответствующего compatibility contract.

1. Для `legacy.*` permissions, старого transfer API, QR aliases, auth importer,
   cookie shape и seed path писать агрегируемые event/outcome без raw identifiers.
2. Сохранять принятый срок 90 дней; отсутствие события не трактовать как нулевое
   использование, пока не подтверждены охват и uptime наблюдения.
3. Quarterly report обновляет owner, период наблюдения, count и решение
   keep/deprecate/remove, но сам код не удаляет.

Проверки: шесть разных inventory IDs; никакой UUID/email в metric label; no-error run
не стирает прежний incident state. Готово, когда у каждого legacy entry есть owner,
полный 90-дневный интервал и воспроизводимый агрегированный отчёт.

## Антицели

- не строить distributed tracing и не логировать body ради диагностики 1С;
- не отправлять логи внутри доменной транзакции;
- не смешивать best-effort Web Push и durable TMC outbox;
- alert destination, escalation и release verdict закрываются задачей 23.

Оценка эффекта: **8.5/10**. Выполнять двумя независимыми PR.
