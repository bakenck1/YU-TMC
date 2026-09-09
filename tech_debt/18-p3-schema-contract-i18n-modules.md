# P3 — trigger-only разбиение schema, contracts и i18n — Done

## Статус на 2026-09-09

- trigger подтверждён: `lib/contracts/tmc-operations.ts` менялся 6 раз за 30 дней;
- один move-only slice вынес все 7 уникальных mutation command DTO в независимый
  `tmc-operation-commands.ts`, сохранив прежний `tmc-operations.ts` barrel API;
- type tests доказывают двустороннюю эквивалентность direct/barrel imports для всех
  exports, а source guard запрещает imports, `server-only`, Zod и DB dependencies в
  client-safe command module;
- read DTO, Zod runtime, schema, migrations, i18n, wire semantics и остальные 41
  top-level statement исходного контракта не изменены;
- full test suite, focused typecheck, lint, `db:check` и production build проходят;
  schema migration diff отсутствует, второй slice остаётся trigger-only.

## Почему это не срочно

`lib/db/schema.ts` — 2797 строк, `lib/i18n.ts` — 2565, TMC contracts — 726. Сейчас
`db:check`, build и key parity проходят. Большой move-only diff без ближайшей продуктовой
работы даст merge conflicts и риск cycles, но почти не даст пользователю ценности.

## Триггер запуска

Начинать только если выполняется хотя бы одно условие:

- одна domain-зона меняется в файле третий раз за 30 дней;
- два параллельных PR регулярно конфликтуют в одном монолите;
- добавление сущности/локали требует unrelated edits и это подтверждено review;
- extraction нужен для конкретной P0/P1 задачи.

## Первый проверяемый slice (M)

Выбрать одну часто меняемую domain-зону (по git evidence), сделать только move-only
разбиение и сохранить прежний barrel/export API.

1. До move сохранить список schema objects/constraints, public exports и i18n key parity.
2. Для schema: общие enums/relations вынести так, чтобы initialization order был явным;
   `drizzle-kit` не должен генерировать migration diff.
3. Для i18n: один и тот же domain fragment для ru/kk/en, typed composition с проверкой
   duplicate keys до object spread.
4. Для contract: отделять command/read DTO только без изменения Zod/wire semantics.
5. Не менять тексты переводов, DB names, types и runtime behavior в этом PR.

## Проверки и запреты

- `db:check`, fresh migration DB, import compatibility, exact key parity, build;
- тест на список schema names/constraints, не snapshot всего generated SQL;
- нет cycles и попадания `server-only` через barrel в client bundle;
- запрещены runtime registry, dynamic loading и новая migration ради TS-переноса.

## Acceptance

Migration diff пуст, старые imports работают, parity точная, cycles нет; изменение
выбранной domain-зоны теперь локализовано. Затем отдельно решить, окупается ли второй slice.

Оценка эффекта: **6/10**, только второй этап.
