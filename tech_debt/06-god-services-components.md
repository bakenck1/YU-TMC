# P2 — разделение god-services и god-components

## Evidence

Крупные units концентрируют несколько независимых workflow:

- `lib/application/services/inventory-item-service.ts` — listing, components,
  comments, attachments, photos, bulk location, protected updates, archive и
  maintenance resolution;
- `lib/application/services/tmc-transfer-request-service.ts` — history,
  projections, create/decision/cancel, idempotency, audit и notifications;
- `components/InventoryItemDetails.tsx` — detail rendering и несколько mutation
  flows;
- `components/InventoryInspectionsManager.tsx` и `components/CampusMap.tsx`
  содержат крупные presentation/state/data blocks.

Это не повод делать полный rewrite: часть сложности — настоящая доменная
сложность. Долг — в accidental coupling и неясных seams.

## Правило extraction

Разделять только при ближайшем изменении workflow. Один extraction — один
стабильный responsibility boundary, без изменения public behavior.

## Рекомендуемые seams

### InventoryItemService

- item lifecycle/create/update/archive;
- comments/attachments;
- photos/service photos;
- component composition;
- bulk location and maintenance resolution;
- shared authorization/DTO helpers оставить в узком domain module.

### TmcTransferRequestService

- request reads/history/projections;
- create command;
- decision command;
- cancellation command;
- idempotency/replay helper;
- notification scheduling.

Transaction boundary и actor reauthorization должны оставаться на server
application layer; нельзя раскладывать authorization по client components.

### Components

Сначала выделять уже очевидные panels/rows/forms, не создавать generic Manager
или BaseDetail. `CampusMap` разрешено оставить с inline CSS для декоративного
canvas-like renderer, если это явно обозначено как intentional exception.

## TDD

1. До extraction зафиксировать текущие route/service tests.
2. Для нового module добавить focused tests на authorization and live
   actor/session, transaction rollback/CAS/version conflicts, DTO privacy and
   projection, loading/error/empty UI states.
3. После каждого шага запускать full relevant suite, `ui:check`, typecheck и
   build.
4. Не переименовывать domain contract только ради меньшего файла.

## Подводные камни

- Нельзя переносить permission check в React.
- Нельзя дать extracted module прямой доступ к `pg` мимо repository port.
- Нельзя смешивать extraction с изменением legacy behavior.
- Нельзя строить abstraction до второго реального consumer.
- Не сломать Storybook import graph и server/client boundary.

## Acceptance

Изменение одного workflow не требует модификации unrelated workflow; service
contracts и route responses не изменились; focused tests показывают сохранение
authorization, transactionality и DTO privacy; component files имеют понятную
ответственность.
