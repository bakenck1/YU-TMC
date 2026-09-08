# P2 — пошаговая декомпозиция application services и adapters

## Evidence и корень долга

`InventoryItemService` — 2119 строк; `TmcTransferRequestService` — 2085;
`UserService` — 1048. PostgreSQL adapters достигают 1108/1332 строк. Долг не в числе
строк самом по себе: изменение одного workflow затрагивает общий constructor, ports,
helpers и крупные test doubles.

## Первый проверяемый seam (рекомендуемый, M)

Вынести comments/attachments из `InventoryItemService` в один cohesion-модуль и
делегировать через прежний facade.

- До move зафиксировать публичные результаты, auth/BOLA, порядок audit и rollback в
  существующих `inventory-item-components*`/comment-attachment тестах; недостающий
  regression test добавить до extraction.
- Сохранить прежние exports, method signatures, DTO/privacy mapping и transaction
  callback. Routes и UI не менять.
- Новый модуль получает только необходимые ports; общий `BaseInventoryService` и
  новый DI framework запрещены.
- Готово, когда facade только делегирует этот workflow, тестовый double не требует
  unrelated photo/lifecycle methods, а `test:all` и PostgreSQL suite зелёные.

## Последующие seams — только вместе с ближайшей доработкой

1. Inventory: composition → photos → bulk commands → lifecycle.
2. TMC: query/history → create → decision → cancellation → idempotency codec.
3. Users: management CRUD отдельно от password/SSO/directory sync.
4. Push: browser subscriptions/direct delivery отдельно от outbox processor.
5. PostgreSQL файлы делить по port/aggregate, сохраняя общий transaction source.

На каждый seam: characterization → move-only → facade delegation → rollback/race
для command → удалить helper после проверки imports. Один PR — один seam.

## Инварианты и антицели

- authorization не переносить в route/UI;
- network side effect не выпускать из after-commit/outbox boundary;
- не менять wire DTO, privacy и error mapping в move-only PR;
- не создавать вложенные независимые UnitOfWork;
- не смешивать extraction с legacy transfer sunset или новой функциональностью;
- ориентир 400–700 строк допустим, но cohesion и локальный diff важнее лимита.

## Acceptance всей инициативы

Каждый извлечённый use case имеет узкие ports/tests, старый facade совместим либо
удалён атомарно, нет cycles, а изменение этого workflow не требует править unrelated
modules/fakes. После первого seam отдельно переоценить окупаемость продолжения.

Оценка эффекта: **8/10**, выполнять инкрементально.
