# P2 — декомпозиция god-components по пользовательским workflow — Done

## Статус на 2026-09-09

- comments/attachments вынесены из `InventoryItemDetails` в самостоятельную
  `InventoryItemComments` feature-панель и use-case hook/controller;
- родитель сохранил публичные props и layout, но больше не владеет comment draft,
  attachment, saving/error state или POST handler;
- сохранены URL, multipart payload, response/error semantics и `router.refresh()`;
  смена item identity/unmount отменяет pending mutation и блокирует late response;
- focused component suite покрывает initial render, permission gating, upload failure,
  сохранение draft для retry, успешный retry/refresh и abort при смене item;
- после первого seam дальнейшие extraction остаются по одному и только вместе с
  ближайшей продуктовой доработкой, как предусмотрено задачей.

## Evidence и корень долга

`InventoryItemDetails.tsx` — 1345 строк, **41 state declaration**, 3 effects и около
12 fetch paths. `InventoryInspectionsManager.tsx` — 755/13; `ItemsTable.tsx` — 635;
`TmcItemQrFlow.tsx` — 605; `TmcBulkActions.tsx` — 532. Оркестраторы одновременно
владеют server state, формами, mutations, conflict refresh, modal state и ошибками.

## Первый проверяемый seam (рекомендуемый, M)

Из `InventoryItemDetails` вынести comments/attachments как feature-панель плюс
use-case hook/controller.

- Сначала добавить focused component test `inventory-item-comments` на initial load,
  add/delete permission, upload failure, retry и refresh после mutation.
- Сохранить публичные props родителя и существующие HTTP URL/payload/error semantics.
- Вынести только состояния и handlers этого workflow; layout и дизайн не менять.
- Данные item/permissions передавать явно, не заводить глобальный store/context.
- Готово, когда этот workflow тестируется без рендера всего details, родитель больше
  не содержит его fetch/mutation handlers и соответствующие state declarations,
  а существующие component tests и Storybook проходят.

## Дальнейший порядок — по одному seam/PR

1. `InventoryItemDetails`: primary photo → service flow → protected fields →
   responsibility → archive/restore.
2. `InventoryInspectionsManager`: query/filter отдельно от create/decision.
3. `ItemsTable`: query/sort/selection отдельно от bulk UI/export dialogs.
4. QR и bulk: scanner lifecycle отдельно от domain command state.

## Правила

- server data, ephemeral UI и form draft не смешивать в одном reducer;
- AbortController/late-response protection и server error code сохраняются;
- optimistic update допустим только с rollback/refetch;
- не вводить generic modal/form framework, Redux или дизайн-редизайн;
- не считать extraction завершённым только из-за уменьшения line count.

## Acceptance инициативы

Каждый вынесенный workflow имеет один owner состояния и focused behavioral tests;
parent координирует панели, а не реализует их transport/domain details. После первого
seam измерить снижение связности и решить, продолжать ли остальные.

Оценка эффекта: **8/10**.
