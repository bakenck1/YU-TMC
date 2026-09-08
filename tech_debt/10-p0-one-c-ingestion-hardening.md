# P0 — безопасный и доказуемый ingestion основных средств из 1С

**Статус: Done (2026-09-08).** Реализованы bounded streaming и deadlines,
строгий XML-контракт, атомарный race-safe UPSERT, межпроцессный PostgreSQL lease,
безопасные ошибки/логи, schema + forward migration и исполняемые HTTP/parser/DB
тесты. Два независимых review-прохода: 7.5/10 и 8.4/10; все перечисленные
actionable findings устранены в пределах установленного лимита проходов.

## Корень долга

`app/api/integrations/1c/fixed-assets/route.ts` и
`lib/server/integrations/one-c-fixed-assets.ts` были добавлены как короткий
интеграционный путь и обошли уже существующие HTTP/application/persistence
границы. GET и XML parser протестированы, но самый важный путь POST -> database
не исполняется тестами.

## Подтверждённые риски

- `request.text()` полностью загружает тело до проверки `MAX_XML_BYTES`; лимит
  после аллокации не защищает память от chunked/ложного `Content-Length` запроса;
- `ingestOneCFixedAssets` возвращает `error.message` по каждой DB-ошибке — наружу
  может уйти имя constraint/table или деталь драйвера;
- `select` перед `upsert` даёт N+1 round trips и неверные created/updated counters
  при конкурентной отправке одного GUID;
- операции выполняются по одной без общей формализованной transaction policy;
- malformed XML отдельно не валидируется через XML validator; рекурсивный поиск
  принимает слишком широкий shape;
- длины строк, число записей и согласованные status/date поля из документации не
  закреплены executable contract;
- таблица inbox создана raw migration, но отсутствует в `lib/db/schema.ts` и
  database integration suite;
- readiness GET всегда говорит `ready`, даже если ключ не настроен;
- POST auth/content-type/oversize/partial failure/concurrency не покрыты.

## Минимальное решение

1. Зафиксировать контракт: максимум 10 MiB по фактически прочитанным байтам,
   bounded records, UTF-8, exact accepted root/item names, безопасные error codes.
2. Читать XML через общий bounded stream reader до преобразования в строку;
   неверный media type отклонять до чтения body.
3. Разделить route concerns, parser/normalizer и repository. Application service
   оркестрирует import, PostgreSQL adapter владеет SQL. Не строить универсальный
   integration framework.
4. Убрать raw exception text из ответа и логировать безопасный request/import ID
   с server-side cause.
5. Выполнять один race-safe upsert path. Counters получать из результата SQL, а
   не из предварительного `select`.
6. Выбрать и документировать одну семантику batch:
   - рекомендуемая: весь XML валидируется до SQL, затем атомарно сохраняется;
   - `207` оставлять только если 1С действительно умеет повторять отдельные
     rejected rows. Тогда ошибки имеют allowlisted code, а не DB message.
7. Добавить schema declaration и проверить соответствие migration/schema.
8. Readiness разделить на `configured` и реальную DB readiness либо честно
   назвать GET `capability`, не обещая доступность базы.
9. Добавить integration-specific rate/concurrency budget до XML parsing,
   statement/transaction timeout и bounded in-flight imports. Конкретные числа
   взять из согласованного графика 1С; безопасный старт — один import на ключ с
   контролируемым `429/503`, а не очередь в памяти процесса.

## TDD-порядок

1. Route tests: missing/wrong key, media type, declared и streamed oversize,
   malformed UTF-8/XML, empty batch, no-store, safe 400/413/415/503.
2. Parser tests: aliases, duplicate GUID в одном batch, max lengths/count,
   decimal/date edges, entity/namespace behavior.
3. Service tests: create/update/unchanged, duplicate policy, safe error mapping.
4. PostgreSQL tests: concurrent same-GUID imports, rollback/partial policy,
   payload hash stability, timeout/backpressure, runtime grants и migration presence.
5. Contract test сверяет `docs/one-c-fixed-assets-api.md` с реальными limits,
   fields и HTTP statuses без хрупкого сравнения всего текста.

## Подводные камни

- Не менять названия XML-тегов без sample payload от 1С.
- Не считать API key достаточной защитой от memory exhaustion.
- Не применять `Promise.all` к тысячам строк и не открывать транзакцию на время
  внешней сети.
- Не логировать XML, ФИО, GUID ответственного или ключ.
- Изменение `207` требует согласования retry behavior отправителя.

## Acceptance

POST нельзя заставить прочитать больше лимита или безгранично накопить imports;
клиент не видит внутренних ошибок; counters корректны при race; выбранная
atomic/partial семантика проверена acceptance-тестом; DB schema и migration
согласованы; все ветки POST исполняются тестами; документация совпадает с
executable contract.

Оценка эффекта: **10/10**. Рекомендуется выполнять первой.
