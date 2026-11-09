# Сопоставление backend-тестов с PostgreSQL — 2026-11-09

## Объём и решение

Проверены 144 файла с прямыми backend-зависимостями, затем индекс расширен до всех 213 корневых тестовых файлов, включая чистые бизнес-правила, косвенные API-зависимости и клиентские проверки: всего 1 225 именованных объявлений до этой дополнительной чистки. Это защищает сопоставление от пропуска backend-правил, импортируемых через общий модуль. В tests/database — 34 файла и 234 объявления после усиления проверок. Параметризация разворачивает их в 255 исполняемых случаев.

Удалены 24 сценария из 9 файлов; maintenance-resolution-service.test.ts удалён целиком. Для каждого удаления указан конкретный DB-сценарий и проверено сохранение полезного поведенческого условия. В 7 DB-файлах усилены проверки результата, аудита, повторов, прав и отсутствия побочных изменений.

[Полная поимённая матрица](backend-test-matrix-2026-11-09.json) содержит все 1 225 исходных объявлений: файл, название, прежнюю и текущую строку, решение и основание. Для 24 удалений replacements — проверенная замена. Для остальных family/databaseSuites обозначает связанные наборы, **не** утверждение, что они полностью заменяют каждый сценарий. Хеш — снимок исходного тела для аудита; он не используется тестами и не запрещает рефакторинг. Индекс клиентских файлов описывает отношение к DB-наборам; он не означает повторного глубокого ревью всех UI-проверок.

Остались 1 073 самостоятельные/дополнительные проверки и 128 кандидатов с проверками исходника/формы SQL. Последние обозначены keep_until_behavioral_replacement: их качество не одобрено, но безопасное удаление без соответствующей проверки поведения не доказано. Это консервативное решение по дублированию, а не заявление об идеальности всех оставшихся тестов.

## Что действительно входит в общий контур

- scripts/test-all.mjs запускает типизацию, Node-тесты, компонентные тесты, затем каждый найденный tests/database/**/*.test.ts, когда заданы обе TEST_DATABASE_URL и TEST_DATABASE_MIGRATOR_URL.
- Локальный test:all без этой пары явно сообщает postgresql=SKIPPED. Одной переменной недостаточно: запуск завершается ошибкой. В CI отсутствие пары также является ошибкой.
- Блокирующий job tests в .github/workflows/tests.yml поднимает PostgreSQL 17, создаёт отдельные migrator/runtime-роли, выполняет миграции и db:smoke, затем npm run test:all с обеими переменными. Проверена конфигурация репозитория; удалённый запуск GitHub Actions в этой работе не наблюдался.
- Новый npm run test:all:local на Windows x64 поднимает одноразовую локальную БД и запускает именно общий test-all с DB-веткой. База останавливается после завершения. test:database:local остаётся командой для отдельного DB-прогона; в CI/Linux используется test:all с подготовленной парой подключений.

При проверке обнаружена ошибка discovery: стандартная конфигурация Vitest видела 4 053 тестовых файла, включая 399 кандидатов tests/database из временных копий и worktree. В vitest.config.mjs теперь явно включён только рабочий tests/database/**/*.test.ts. Фактическое discovery возвращает ровно 34 файла. Общий и локальный runner используют одинаковые аргументы запуска; поиск поддерживает вложенные каталоги. Параллельное выполнение DB-файлов отключено: они пересоздают общую тестовую схему.

Тест discovery в ci-release-contract переписан: создаёт временное дерево с вложенным suite, support-файлом, backup и чужим worktree, затем проверяет конкретный ожидаемый список. Он больше не повторяет реализацию поиска для вычисления собственного ожидания.

Каждый DB-файл теперь оставляет JSON-отчёт в .artifacts/database-tests. [Протокол фактического выполнения](backend-test-execution-2026-11-09.json) сопоставляет объявления с развёрнутыми именами выполненных тестов: для каждого файла и каждого сценария виден passed. Учитываются только свежие отчёты текущего общего прогона.

## Удалённые дубли и их замещение

| Файл и название удалённого теста | Конкретная проверка PostgreSQL | Основание |
| --- | --- | --- |
| tests/tmc-transfer-request-create-service.test.ts — replays the exact TMC create result without a second mutation | tests/database/tmc-transfer-request-idempotency-transactions.test.ts — replays TMC create idempotently across PostgreSQL connections | Две связи PostgreSQL возвращают тот же результат и resourceId; сохраняется один родитель. Подсчёт вставок fake-репозитория избыточен. |
| tests/tmc-transfer-request-create-service.test.ts — rejects reuse of a TMC idempotency key for a different payload | tests/database/tmc-transfer-request-idempotency-transactions.test.ts — replays TMC create idempotently across PostgreSQL connections | Реальная БД отвергает другой порядок входного набора с тем же ключом; HTTP-набор дополнительно проверяет другой itemId и 409. |
| tests/tmc-transfer-request-create-service.test.ts — replays an all-problem result without creating a parent | tests/database/tmc-transfer-request-idempotency-transactions.test.ts — replays TMC create idempotently across PostgreSQL connections | Добавлен повтор результата без ресурса, статус 200 и неизменность числа реальных заявок. |
| tests/tmc-transfer-request-create-service.test.ts — rolls back the TMC mutation when idempotency completion fails | tests/database/tmc-transfer-request-idempotency-transactions.test.ts — replays TMC create idempotently across PostgreSQL connections | Ошибка после записи completion откатывает настоящую транзакцию и резервирование; повтор затем проходит. Fake-UoW дублирует rollback. |
| tests/tmc-transfer-request-create-service.test.ts — allows a warehouse user to transfer an item they currently own | tests/database/tmc-transfer-request-authorization-transactions.test.ts — enforces employee ownership and the administrator override in PostgreSQL | Реальный warehouse создаёт заявку, проверяются included, initiator и сохранённый снимок владельца. |
| tests/tmc-transfer-request-create-service.test.ts — uses the current database role instead of a stale admin actor | tests/database/tmc-transfer-request-authorization-transactions.test.ts — enforces employee ownership and the administrator override in PostgreSQL | Сохранённый employee со старой ролью admin не получает чужой предмет; request=null и число заявок не меняется. |
| tests/tmc-transfer-request-create-service.test.ts — does not persist a parent for an all-foreign employee batch | tests/database/tmc-transfer-request-authorization-transactions.test.ts — enforces employee ownership and the administrator override in PostgreSQL | DB-сценарий расширен до двух чужих позиций: обе получают item_unavailable, родитель не сохраняется. |
| tests/tmc-transfer-request-create-service.test.ts — continues after known late item conflicts and preserves outcome order | tests/database/tmc-transfer-request-create-transactions.test.ts — isolates late item conflicts and rolls back an empty parent | Настоящая ошибка ограничения в средней из трёх позиций откатывается savepoint; порядок included/problem/included и две сохранённые позиции проверены. |
| tests/tmc-transfer-request-decision-service.test.ts — decision binds transactional authorization to the authenticated session version | tests/database/tmc-transfer-request-decision-transactions.test.ts — fences decision BOLA, revoked sessions, replays, and concurrent commits in PostgreSQL | Сессия отозвана в БД между созданием и решением; старая версия отвергается, новая завершает ту же команду. |
| tests/tmc-transfer-request-decision-service.test.ts — decision replays idempotently without applying responsibility twice | tests/database/tmc-http-behavior.test.ts — commits mixed decisions, replays them and changes only the accepted responsibility<br>tests/database/tmc-transfer-request-decision-transactions.test.ts — fences decision BOLA, revoked sessions, replays, and concurrent commits in PostgreSQL | HTTP-повтор теперь меняет порядок решений и полей; ответ идентичен, открытый владелец и число периодов не дублируются. |
| tests/tmc-transfer-request-cancel-service.test.ts — initiator can cancel a pending request while unrelated users receive hidden not-found | tests/database/tmc-transfer-request-cancel-transactions.test.ts — fences cancellation BOLA, revoked sessions, parent scope, audit metadata, and overdue outbox in PostgreSQL | PostgreSQL проверяет инициатора, malformed/missing/recipient/outsider, safeDetails, отзыв сессии до команды и replay; добавлено сравнение реальных аудитов, уведомлений и outbox до/после повторов. |
| tests/tmc-transfer-request-cancel-service.test.ts — cancellation hides malformed, missing, recipient and outsider request scopes uniformly | tests/database/tmc-transfer-request-cancel-transactions.test.ts — fences cancellation BOLA, revoked sessions, parent scope, audit metadata, and overdue outbox in PostgreSQL | PostgreSQL проверяет инициатора, malformed/missing/recipient/outsider, safeDetails, отзыв сессии до команды и replay; добавлено сравнение реальных аудитов, уведомлений и outbox до/после повторов. |
| tests/tmc-transfer-request-cancel-service.test.ts — cancellation replays idempotently without duplicate audit or notifications | tests/database/tmc-transfer-request-cancel-transactions.test.ts — fences cancellation BOLA, revoked sessions, parent scope, audit metadata, and overdue outbox in PostgreSQL | PostgreSQL проверяет инициатора, malformed/missing/recipient/outsider, safeDetails, отзыв сессии до команды и replay; добавлено сравнение реальных аудитов, уведомлений и outbox до/после повторов. |
| tests/tmc-transfer-request-cancel-service.test.ts — cancellation binds mutation and replay authorization to the authenticated session version | tests/database/tmc-transfer-request-cancel-transactions.test.ts — fences cancellation BOLA, revoked sessions, parent scope, audit metadata, and overdue outbox in PostgreSQL | PostgreSQL проверяет инициатора, malformed/missing/recipient/outsider, safeDetails, отзыв сессии до команды и replay; добавлено сравнение реальных аудитов, уведомлений и outbox до/после повторов. |
| tests/asset-loss-service.test.ts — receipt replacement supersedes the old binary before the guarded transition | tests/database/asset-loss.test.ts — supersedes a rejected receipt in the same state transition | В БД проверяются attached/superseded и новые bytes; дополнительно проверены состояние accounting_review и ребро rejected → accounting_review. Порядок вызовов mock не нужен. |
| tests/asset-loss-service.test.ts — approval rejects a replacement period even when it belongs to the same employee | tests/database/asset-loss.test.ts — approval rejects same-employee ABA responsibility and leaves the replacement period open | Настоящая ABA-замена периода того же сотрудника даёт loss_responsibility_changed; новый период остаётся открытым, дело не закрывается. |
| tests/maintenance-resolution-service.test.ts — only an administrator can resolve a maintenance item and the resolution is audited | tests/database/maintenance-resolution.test.ts — resolves a maintenance item to %s and returns its new state<br>tests/database/maintenance-resolution.test.ts — rejects a formerly privileged user's repair request after demotion to %s | PATCH проверяет оба исхода, сохранённый аудит before/after и actor, отказ employee/warehouse даже со старой admin-cookie. Фиксированное время и аргументы mock избыточны. |
| tests/maintenance-resolution-service.test.ts — a maintenance resolution cannot change an item that is no longer in service | tests/database/maintenance-resolution.test.ts — rejects resolution after an item has left maintenance without writing an audit | PATCH возвращает 409/item_not_in_maintenance; статус, версия и аудит реальной БД не меняются. |
| tests/tmc-bulk-project-service.test.ts — project bulk change updates all rows, preserves other fields, audits, and can remove the flag | tests/database/inventory-policy-adversarial.test.ts — bulk project flag persists for all selected items and rolls back a batch with an unavailable item | Добавлены реальные владельцы и сравнение полей/версий до и после установки/снятия флага; сохранённый audit before/after проверен. |
| tests/tmc-bulk-project-service.test.ts — reapplying the project flag makes no extra writes or audit records | tests/database/inventory-policy-adversarial.test.ts — bulk project flag persists for all selected items and rolls back a batch with an unavailable item | Повтор установки того же флага сохраняет строки, версии и число аудитов. Ручная реализация rollback в fake больше не нужна для этого сценария. |
| tests/tmc-bulk-one-c-code-service.test.ts — reapplying a saved code is a successful no-op | tests/database/inventory-policy-adversarial.test.ts — bulk 1C code persists with leading zeroes, reloads in cards and rolls back an incomplete batch | Повтор сохранённого кода проверяется по реальным версиям, значениям и неизменному числу аудитов. |
| tests/inventory-list-repository.test.ts — dedicated 1C code mutation uses a version check, touches only its field and reloads the saved value | tests/database/inventory-policy-adversarial.test.ts — bulk 1C code persists with leading zeroes, reloads in cards and rolls back an incomplete batch | Реальная запись/reload сохраняет код с нулями и количество 28, остальные поля и CAS проверены. SQL-шаблон и ровно два query — детали реализации. |
| tests/inventory-list-repository.test.ts — a stale 1C code write does not reload or return an unsaved item | tests/database/inventory-policy-adversarial.test.ts — bulk 1C code persists with leading zeroes, reloads in cards and rolls back an incomplete batch | Добавлен вызов настоящего адаптера с устаревшей версией: возвращается null, сохранённые код и версия не меняются. Ровно один query не является контрактом. |
| tests/one-c-fixed-assets.test.ts — upserts a complete batch in one PostgreSQL statement and preserves counters | tests/database/one-c-fixed-assets.test.ts — classifies concurrent create, unchanged replay, and update without a pre-select race<br>tests/database/one-c-fixed-assets.test.ts — replays differently-cased UUIDs into one canonical inbox row | Реальные create/update/unchanged, сохранённые payload/hash и канонический externalId проверены на PostgreSQL. jsonb_to_recordset и число SQL-операторов не фиксируем. |

## Усиленные проверки перед удалением

- maintenance-resolution: реальный PATCH, аудит actor/before/after для обоих исходов, запрет после понижения до employee/warehouse и 409 без аудита, когда предмет уже вышел из ремонта.
- asset-loss: после замены квитанции проверяется сохранённое accounting_review и событие rejected → accounting_review.
- TMC authorization: собственный предмет warehouse, актуальная роль вместо устаревшей admin, два чужих предмета без сохранения пустой заявки.
- TMC idempotency: сохранённый resourceId и статус; повтор результата без ресурса через другой экземпляр сервиса без новой заявки.
- TMC HTTP: повтор смешанного решения с переставленными решениями и порядком полей не меняет результат и периоды ответственности.
- inventory-policy: установка/снятие project сохраняет прочие поля и владельца, аудит содержит before/after; повтор не меняет версии/аудит. Код 1С сохраняет ведущие нули и количество; настоящий адаптер отвергает устаревшую версию без изменения сохранённых данных.
- TMC cancel: malformed/missing/recipient/outsider скрываются одинаково; отказ и повтор сравниваются по реальным audit, notifications и outbox, уведомление об отмене не дублируется.

## Почему похожие тесты оставлены

Web Push: уникальность endpoint в PostgreSQL не заменяет преобразование конфликта в ошибку сервиса и проверку владения при unsubscribe. Yessenov: обновление personnel по прежней почте не заменяет привязку provider subject при изменившейся почте и гонку первого входа.

1С: сохранение snapshot/batch в БД обходит XML-парсер, подпись, ограничения размера и числа записей. Эти проверки не дублируют импорт в PostgreSQL. HTTP-ограничения тела, cookie/cache, Retry-After и сбои внешнего провайдера также не следуют из успешной записи репозитория.

Проверки декодирования фото/EXIF и алгоритмов сопоставления источников покрывают другие входные данные и границы, чем хранение bytes/несколько DB-fixtures. Дешёвые проверки результата сохранены там, где они ловят самостоятельную ошибку.

## Реальные границы DB-покрытия

Наличие DB-набора не означает проверку полного эндпоинта. Только 5 из 34 файлов напрямую импортируют реальные app/api handlers: tmc-http-behavior, legacy-transfer-http, maintenance-resolution, one-c-reconciliation-http и часть inventory-transfer-override. Остальные преимущественно проверяют сервисы, репозитории, ограничения и миграции с PostgreSQL; часть HTTP-проверок вызывает вынесенные handlers. Поле directRouteImports в матрице фиксирует именно прямой импорт, а не исчерпывающую классификацию HTTP.

Сохраняются пробелы, из-за которых похожие unit/route-проверки удалять нельзя:

- inspections: нет полного DB-прогона прав, мутаций и выдачи эндпоинтов;
- обычные service-requests: DB-набор dormitory и хранение фото не заменяют collection/status BOLA и переходы обычных заявок;
- comments/attachments: нет полного DB-контракта ancestry и видимости вложений;
- IT inventory: DB-хранение не заменяет матрицу прав и сокрытие сетевых данных на HTTP-границе;
- recipient candidates и bulk-location: нет эквивалентного DB-прогона прав кандидатов и частичных исходов переноса в целевую комнату.

Эти проверки оставлены до появления соответствующей поведенческой интеграции. Проверки разметки, форматирования и точных текстов страницы в этот backend-проход не добавлялись.

## Проверки после изменений

Общий запуск `npm run test:all:local` завершился с кодом 0: типизация, 1 393 Node-теста (1 376 server + 17 client), 511 компонентных тестов и 255 PostgreSQL-случаев в 34 файлах прошли. Итог runner: unit-route=ran, ui=ran, component=ran, postgresql=ran.

Дополнительно сопоставлены свежие JSON-отчёты со всеми 234 DB-объявлениями: каждый сценарий выполнен хотя бы в одном варианте, все 255 результатов passed, failed/skipped — 0; discovery совпадает с набором 34 исполненных файлов. После переписывания discovery отдельно прошли все 7 тестов ci-release-contract. Полный lint и docs:check прошли. Browser smoke повторно не запускался: этот проход меняет backend-тесты и их запуск, а не UI.

## Полный индекс backend-файлов

Поимённые решения всех сценариев находятся в `backend-test-matrix-2026-11-09.json`. Здесь — сводка каждого исходного файла; номера означают объявления сценариев, а не развёрнутые строки it.each.

| Файл | Сценарии до | Удалены | Семейство | Связанные PostgreSQL suites |
| --- | ---: | ---: | --- | --- |
| tests/application-error-boundary.test.ts | 2 | 0 | errors | Нет эквивалентного DB-набора |
| tests/application-service-contracts.test.ts | 19 | 0 | application-services | room-duplicate-prevention.test.ts, room-passports.test.ts, inventory-collection-cursor.test.ts, tmc-transfer-request-idempotency-transactions.test.ts |
| tests/asset-loss-route.test.ts | 4 | 0 | asset-loss | asset-loss.test.ts, asset-loss-upgrade.test.ts |
| tests/asset-loss-service.test.ts | 10 | 2 | asset-loss | asset-loss.test.ts, asset-loss-upgrade.test.ts |
| tests/cabinet-access-adversarial.test.ts | 6 | 0 | cabinet-scope | inventory-collection-cursor.test.ts, room-passports.test.ts |
| tests/ci-release-contract.test.ts | 7 | 0 | infrastructure | Нет эквивалентного DB-набора |
| tests/code-resolution.test.ts | 12 | 0 | qr-and-pages | inventory-collection-cursor.test.ts, tmc-http-behavior.test.ts |
| tests/collection-limits.test.ts | 2 | 0 | collection-limits | inventory-collection-cursor.test.ts |
| tests/comment-attachment-idor.test.ts | 5 | 0 | comments | inventory-collection-cursor.test.ts |
| tests/database-target.test.ts | 4 | 0 | infrastructure | Нет эквивалентного DB-набора |
| tests/decommissioned-items-service.test.ts | 12 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/dockflow-test-api.test.ts | 15 | 0 | external-dockflow | dockflow-api.test.ts |
| tests/dormitory-api.test.ts | 6 | 0 | dormitory-read | inventory-policy-adversarial.test.ts |
| tests/dormitory-requests-api.test.ts | 5 | 0 | dormitory-write | dormitory-requests.test.ts |
| tests/employee-owned-items-service.test.ts | 7 | 0 | cabinet-scope | inventory-collection-cursor.test.ts, room-passports.test.ts |
| tests/employee-service-request.test.ts | 1 | 0 | service-requests | dormitory-requests.test.ts, photo-contracts.test.ts |
| tests/forgot-password-security.test.ts | 5 | 0 | authentication | persistent-users.test.ts |
| tests/google-sso-route.test.ts | 2 | 0 | authentication | persistent-users.test.ts |
| tests/google-sso-user-service.test.ts | 3 | 0 | authentication | persistent-users.test.ts |
| tests/google-sso.test.ts | 4 | 0 | authentication | persistent-users.test.ts |
| tests/integration-api.test.ts | 12 | 0 | external-integration | integration-api.test.ts |
| tests/inventory-audit-enrichment-route.test.ts | 13 | 0 | enrichment-http | inventory-audit-enrichment.test.ts |
| tests/inventory-excel.test.ts | 10 | 0 | inventory-export | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/inventory-export-location.test.ts | 5 | 0 | inventory-export | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/inventory-inspection-admin.test.ts | 1 | 0 | inspections | Нет эквивалентного DB-набора |
| tests/inventory-inspection-result-bola.test.ts | 1 | 0 | inspections | Нет эквивалентного DB-набора |
| tests/inventory-inspection-room-bola.test.ts | 2 | 0 | inspections | Нет эквивалентного DB-набора |
| tests/inventory-item-categories.test.ts | 2 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-item-comment-service.test.ts | 2 | 0 | comments | inventory-collection-cursor.test.ts |
| tests/inventory-item-components-route.test.ts | 5 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-item-components.test.ts | 16 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-item-photo-access.test.ts | 14 | 0 | item-photos | photo-contracts.test.ts, tmc-http-behavior.test.ts |
| tests/inventory-item-responsible.test.ts | 3 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-list-repository.test.ts | 6 | 2 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-number-pair-policy.test.ts | 3 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-one-c-visibility.test.ts | 9 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-policy-adversarial.test.ts | 17 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-policy-route-adversarial.test.ts | 4 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-search-identifiers.test.ts | 4 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-source-audit-excel.test.ts | 9 | 0 | inventory-export | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/inventory-source-audit-number-attacks.test.ts | 9 | 0 | source-audit | one-c-fixed-assets.test.ts, inventory-source-audit-metadata-attacks.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-source-audit-whitespace-attacks.test.ts | 10 | 0 | source-audit | one-c-fixed-assets.test.ts, inventory-source-audit-metadata-attacks.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-summary-navigation-print.test.ts | 1 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/inventory-transfer-cancel-bola.test.ts | 6 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-cancel-route.test.ts | 5 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-decision-bola.test.ts | 6 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-decision-route.test.ts | 4 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-http-boundary.test.ts | 2 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-list-bola.test.ts | 3 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-list-route.test.ts | 3 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-override-bola.test.ts | 10 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-override-route.test.ts | 6 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/inventory-transfer-workflow.test.ts | 7 | 0 | legacy-transfers | legacy-transfer-http.test.ts, inventory-transfer-override.test.ts |
| tests/it-inventory-adversarial.test.ts | 7 | 0 | it-inventory | inventory-policy-adversarial.test.ts, inventory-audit-enrichment.test.ts, one-c-material-audit.test.ts |
| tests/it-inventory-security-regressions.test.ts | 8 | 0 | it-inventory | inventory-policy-adversarial.test.ts, inventory-audit-enrichment.test.ts, one-c-material-audit.test.ts |
| tests/it-inventory.test.ts | 11 | 0 | it-inventory | inventory-policy-adversarial.test.ts, inventory-audit-enrichment.test.ts, one-c-material-audit.test.ts |
| tests/item-detail-page-idor.test.ts | 3 | 0 | qr-and-pages | inventory-collection-cursor.test.ts, tmc-http-behavior.test.ts |
| tests/item-qr-page-idor.test.ts | 5 | 0 | qr-and-pages | inventory-collection-cursor.test.ts, tmc-http-behavior.test.ts |
| tests/local-barcode.test.ts | 5 | 0 | local-barcodes | local-barcodes.test.ts, tmc-transfer-request-create-transactions.test.ts, inventory-collection-cursor.test.ts |
| tests/login-security.test.ts | 8 | 0 | authentication | persistent-users.test.ts |
| tests/logout-security.test.ts | 3 | 0 | authentication | persistent-users.test.ts |
| tests/maintenance-resolution-service.test.ts | 2 | 2 | maintenance | maintenance-resolution.test.ts |
| tests/manual-barcode-item-create.test.ts | 3 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/material-snapshot-one-c-code.test.ts | 6 | 0 | legacy-material-snapshot | one-c-fixed-assets.test.ts |
| tests/material-snapshot.test.ts | 3 | 0 | legacy-material-snapshot | one-c-fixed-assets.test.ts |
| tests/material-statement-one-c-code.test.ts | 2 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-analytics-active-scope.test.ts | 1 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-analytics-excel.test.ts | 8 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-analytics.test.ts | 10 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-current-enrichment-handler.test.ts | 3 | 0 | one-c-http | one-c-reconciliation-http.test.ts, one-c-fixed-assets.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-decommissioned-registry.test.ts | 2 | 0 | one-c-registry | one-c-material-audit.test.ts, one-c-reconciliation-http.test.ts |
| tests/one-c-fixed-asset-registry.test.ts | 4 | 0 | one-c-registry | one-c-material-audit.test.ts, one-c-reconciliation-http.test.ts |
| tests/one-c-fixed-assets.test.ts | 17 | 1 | one-c-fixed-import | one-c-fixed-assets.test.ts |
| tests/one-c-full-cost-import.test.ts | 9 | 0 | one-c-full-cost | one-c-material-audit.test.ts, one-c-materials.test.ts |
| tests/one-c-material-admin-routes.test.ts | 6 | 0 | one-c-http | one-c-reconciliation-http.test.ts, one-c-fixed-assets.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-material-registry.test.ts | 8 | 0 | one-c-registry | one-c-material-audit.test.ts, one-c-reconciliation-http.test.ts |
| tests/one-c-materials-membership.test.ts | 2 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-materials-route.test.ts | 2 | 0 | one-c-material-import | one-c-materials.test.ts |
| tests/one-c-materials.test.ts | 23 | 0 | one-c-material-import | one-c-materials.test.ts |
| tests/one-c-reconciliation-analysis-service.test.ts | 1 | 0 | one-c-http | one-c-reconciliation-http.test.ts, one-c-fixed-assets.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-reconciliation-candidates.test.ts | 4 | 0 | one-c-http | one-c-reconciliation-http.test.ts, one-c-fixed-assets.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-reconciliation-excel.test.ts | 2 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-reconciliation-routes.test.ts | 13 | 0 | one-c-http | one-c-reconciliation-http.test.ts, one-c-fixed-assets.test.ts, inventory-audit-enrichment.test.ts |
| tests/one-c-temporary-material-code.test.ts | 9 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/one-c-temporary-os-code.test.ts | 6 | 0 | one-c-analysis | one-c-material-audit.test.ts, one-c-fixed-assets.test.ts |
| tests/pdf-validation-gate.test.ts | 2 | 0 | pdf-and-photo-policy | room-passports.test.ts, photo-contracts.test.ts |
| tests/photo-access-permissions.test.ts | 2 | 0 | pdf-and-photo-policy | room-passports.test.ts, photo-contracts.test.ts |
| tests/postgres-unit-of-work-savepoints.test.ts | 5 | 0 | unit-of-work | tmc-transfer-request-create-transactions.test.ts, inventory-audit-enrichment.test.ts, inventory-transfer-override.test.ts |
| tests/push-notification-integration.test.ts | 11 | 0 | push | web-push-repositories.test.ts, tmc-operation-repositories.test.ts, tmc-http-behavior.test.ts |
| tests/registration-bootstrap-security.test.ts | 10 | 0 | authentication | persistent-users.test.ts |
| tests/release-evidence.test.ts | 3 | 0 | infrastructure | Нет эквивалентного DB-набора |
| tests/reset-password-route-security.test.ts | 1 | 0 | authentication | persistent-users.test.ts |
| tests/role-model.test.ts | 5 | 0 | authentication | persistent-users.test.ts |
| tests/room-booking.test.ts | 7 | 0 | room-booking | Нет эквивалентного DB-набора |
| tests/room-creation-without-responsible.test.ts | 4 | 0 | rooms | room-duplicate-prevention.test.ts, item-responsible-form.test.ts |
| tests/room-passport-routes.test.ts | 5 | 0 | passports | room-passports.test.ts |
| tests/room-passport.test.ts | 9 | 0 | passports | room-passports.test.ts |
| tests/security-hardening.test.ts | 7 | 0 | authentication | persistent-users.test.ts |
| tests/service-request-status-bola.test.ts | 9 | 0 | service-requests | dormitory-requests.test.ts, photo-contracts.test.ts |
| tests/service-request-status-route.test.ts | 5 | 0 | service-requests | dormitory-requests.test.ts, photo-contracts.test.ts |
| tests/service-requests-collection-bola.test.ts | 9 | 0 | service-requests | dormitory-requests.test.ts, photo-contracts.test.ts |
| tests/session-secret.test.ts | 1 | 0 | infrastructure | Нет эквивалентного DB-набора |
| tests/settings-import.test.ts | 5 | 0 | settings | settings-persistence.test.ts |
| tests/settings-repository.test.ts | 6 | 0 | settings | settings-persistence.test.ts |
| tests/structured-observability.test.ts | 10 | 0 | infrastructure | Нет эквивалентного DB-набора |
| tests/tmc-bulk-location-route.test.ts | 3 | 0 | tmc-bulk-location | Нет эквивалентного DB-набора |
| tests/tmc-bulk-location-service.test.ts | 2 | 0 | tmc-bulk-location | Нет эквивалентного DB-набора |
| tests/tmc-bulk-one-c-code-route.test.ts | 4 | 0 | tmc-bulk-code-project | inventory-policy-adversarial.test.ts |
| tests/tmc-bulk-one-c-code-service.test.ts | 4 | 1 | tmc-bulk-code-project | inventory-policy-adversarial.test.ts |
| tests/tmc-bulk-project-service.test.ts | 4 | 2 | tmc-bulk-code-project | inventory-policy-adversarial.test.ts |
| tests/tmc-entry-point.test.ts | 1 | 0 | tmc-contracts | tmc-operation-migration.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-operation-contracts.test.ts | 2 | 0 | tmc-contracts | tmc-operation-migration.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-operation-migration.test.ts | 3 | 0 | tmc-contracts | tmc-operation-migration.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-operation-permissions.test.ts | 1 | 0 | tmc-contracts | tmc-operation-migration.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-push-outbox.test.ts | 2 | 0 | push | web-push-repositories.test.ts, tmc-operation-repositories.test.ts, tmc-http-behavior.test.ts |
| tests/tmc-recipient-candidates-authorization.test.ts | 3 | 0 | tmc-recipient | persistent-users.test.ts |
| tests/tmc-recipient-candidates-route.test.ts | 6 | 0 | tmc-recipient | persistent-users.test.ts |
| tests/tmc-stage-four-migration.test.ts | 4 | 0 | tmc-contracts | tmc-operation-migration.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-stage-four-routes.test.ts | 3 | 0 | tmc-http | tmc-http-behavior.test.ts, tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-decision-transactions.test.ts |
| tests/tmc-stage-four-service.test.ts | 9 | 0 | tmc-history | tmc-operation-repositories.test.ts, tmc-http-behavior.test.ts |
| tests/tmc-transfer-request-cancel-route.test.ts | 4 | 0 | tmc-http | tmc-http-behavior.test.ts, tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-decision-transactions.test.ts |
| tests/tmc-transfer-request-cancel-service.test.ts | 8 | 4 | tmc-cancel | tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-race-transactions.test.ts, tmc-http-behavior.test.ts |
| tests/tmc-transfer-request-create-service.test.ts | 31 | 8 | tmc-create | tmc-transfer-request-idempotency-transactions.test.ts, tmc-transfer-request-authorization-transactions.test.ts, tmc-transfer-request-create-transactions.test.ts, tmc-http-behavior.test.ts |
| tests/tmc-transfer-request-decision-route.test.ts | 5 | 0 | tmc-http | tmc-http-behavior.test.ts, tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-decision-transactions.test.ts |
| tests/tmc-transfer-request-decision-service.test.ts | 10 | 2 | tmc-decision | tmc-transfer-request-decision-transactions.test.ts, tmc-operation-repositories.test.ts, tmc-http-behavior.test.ts |
| tests/tmc-transfer-request-detail-route.test.ts | 5 | 0 | tmc-http | tmc-http-behavior.test.ts, tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-decision-transactions.test.ts |
| tests/tmc-transfer-request-read-service.test.ts | 7 | 0 | tmc-read | tmc-http-behavior.test.ts, tmc-operation-repositories.test.ts |
| tests/tmc-transfer-request-route.test.ts | 12 | 0 | tmc-http | tmc-http-behavior.test.ts, tmc-transfer-request-cancel-transactions.test.ts, tmc-transfer-request-decision-transactions.test.ts |
| tests/tmc-user-picker.test.ts | 6 | 0 | tmc-recipient | persistent-users.test.ts |
| tests/typography-isolation.test.ts | 1 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/tz-inventory-adversarial.test.ts | 12 | 0 | local-barcodes | local-barcodes.test.ts, tmc-transfer-request-create-transactions.test.ts, inventory-collection-cursor.test.ts |
| tests/users-collection-authorization.test.ts | 4 | 0 | authentication | persistent-users.test.ts |
| tests/users-id-authorization.test.ts | 2 | 0 | authentication | persistent-users.test.ts |
| tests/warehouse-readonly.test.ts | 4 | 0 | inventory-core | inventory-policy-adversarial.test.ts, item-responsible-form.test.ts, inventory-collection-cursor.test.ts, inventory-audit-enrichment.test.ts |
| tests/web-push-service.test.ts | 15 | 0 | push | web-push-repositories.test.ts, tmc-operation-repositories.test.ts, tmc-http-behavior.test.ts |
| tests/whatsapp-gateway.test.ts | 7 | 0 | whatsapp | whatsapp-notifications.test.ts |
| tests/whatsapp-phone-onboarding.test.ts | 1 | 0 | whatsapp | whatsapp-notifications.test.ts |
| tests/whatsapp-tmc.test.ts | 8 | 0 | whatsapp | whatsapp-notifications.test.ts |
| tests/whatsapp-user-phone.test.ts | 3 | 0 | whatsapp | whatsapp-notifications.test.ts |
| tests/yessenov-auto-login.test.ts | 2 | 0 | authentication | persistent-users.test.ts |
| tests/yessenov-sso-route.test.ts | 2 | 0 | authentication | persistent-users.test.ts |
| tests/yessenov-sso-user-service.test.ts | 4 | 0 | authentication | persistent-users.test.ts |
| tests/yessenov-sso.test.ts | 3 | 0 | authentication | persistent-users.test.ts |
| tests/yessenov-user-directory-sync.test.ts | 1 | 0 | authentication | persistent-users.test.ts |
| tests/additional-inventory-buildings.test.ts | 3 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/analytics-filters.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/backup-postgres-connection.test.ts | 3 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/browser-smoke-contract.test.ts | 4 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/campus-center-renaming.test.ts | 1 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/campus-dormitory-renaming.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/campus-map-2gis.test.ts | 6 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/capacity-baseline.test.ts | 5 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/code39.test.ts | 9 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/decommissioned-items.test.ts | 5 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/deployment-runtime-env.test.ts | 3 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/documentation-consistency.test.ts | 2 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/employee-asset-workflow.test.ts | 4 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/employee-items-tabs.test.ts | 6 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/facilities-api.test.ts | 6 | 0 | external-facilities | room-passports.test.ts |
| tests/i18n.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-audit-enrichment-priority-review.test.ts | 2 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/inventory-audit-enrichment.test.ts | 28 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/inventory-columns.test.ts | 1 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-inspection-result-route.test.ts | 1 | 0 | inspections | Нет эквивалентного DB-набора |
| tests/inventory-inspection-selection.test.ts | 1 | 0 | inspections | Нет эквивалентного DB-набора |
| tests/inventory-invoice.test.ts | 5 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-item-content-client.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-item-details-presentation.test.ts | 3 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-item-photo-client.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-list-state.test.ts | 10 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-number-label.test.ts | 5 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/inventory-room-floors.test.ts | 13 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-search.test.ts | 6 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-source-audit-composed-format.test.ts | 3 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/inventory-source-audit.test.ts | 26 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/inventory-status-filter.test.ts | 11 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/inventory-summary.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/it-inventory-ui.test.ts | 1 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/legacy-compatibility-contract.test.ts | 3 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/legacy-usage-report.test.ts | 3 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/maintenance-inspections.test.ts | 1 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/maintenance-resolution-client.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/monitor-production-errors.test.ts | 5 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/off-campus-dormitories.test.ts | 4 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/one-c-adversarial-index.test.ts | 1 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-card-identifier-enrichment.test.ts | 7 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-enrichment-full-search.test.ts | 11 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-enrichment-price.test.ts | 4 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-excluded-system-unit-responsibility.test.ts | 4 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-false-positive-identities.test.ts | 7 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-fill-missing-responsibility.test.ts | 12 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-format-matching.test.ts | 10 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-independent-prices.test.ts | 15 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-inventory-presence.test.ts | 3 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-name-owner-price.test.ts | 4 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-name-owner.test.ts | 8 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-publication-plan.test.ts | 5 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/one-c-reconciliation-analysis.test.ts | 11 | 0 | domain-enrichment | inventory-audit-enrichment.test.ts, one-c-fixed-assets.test.ts, one-c-material-audit.test.ts |
| tests/personnel-import.test.ts | 2 | 0 | directory-input | persistent-users.test.ts |
| tests/pwa-camera-scanner.test.ts | 5 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/repository-artifacts-contract.test.ts | 2 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/repository-hygiene.test.ts | 2 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/room-passport-list-state.test.ts | 2 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/room-service-requests.test.ts | 7 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/search-history.test.ts | 5 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/service-request-photo-normalization.test.ts | 4 | 0 | photo-normalization | photo-contracts.test.ts |
| tests/sidebar-navigation.test.ts | 4 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/tmc-history-page-idor.test.ts | 2 | 0 | page-privacy | tmc-http-behavior.test.ts |
| tests/tmc-qr-flow.test.ts | 8 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/tmc-transfer-request-card.test.ts | 3 | 0 | client-and-pure-view-rules | Нет эквивалентного DB-набора |
| tests/tmc-transfer-request-detail-page-idor.test.ts | 4 | 0 | page-privacy | tmc-http-behavior.test.ts |
| tests/toolchain-contract.test.ts | 5 | 0 | operational-tools | Нет эквивалентного DB-набора |
| tests/yessenov-directory.test.ts | 4 | 0 | directory-input | persistent-users.test.ts |
