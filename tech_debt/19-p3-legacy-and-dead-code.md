# P3 — управляемый sunset legacy и доказанные рудименты

## Поддерживаемый legacy

Реестр содержит шесть compatibility paths: `legacy.*` permissions, старый
`/api/inventory/transfers`, QR `legacy_raw`/`legacy_url`, auth credential importer,
cookie shape с email `sub` и seed-only `lib/data.ts`. До 90-дневного evidence из задачи
14 ни один путь удалять нельзя.

## Кандидаты, а не доказанный dead code

- `lib/items-21-110.ts`: imports не найдены, но надо исключить operator/file usage;
- часть exports `lib/data.ts` не используется seed script;
- `FileSettingsRepository`: source consumers не найдены, однако документация называет
  его rollback compatibility — требуется явное подтверждение recovery owner;
- два transfer domains расширяют schema/SQL/test surface до решения о sunset.

Dependencies сюда не входят: быстрый dependency cleanup находится в задаче 21.

## Минимальный порядок

1. Для file/CLI кандидата проверить `rg`, build graph, scripts/runbooks и owner sign-off.
2. Удалять один доказанный orphan отдельным PR; seed dataset одновременно не менять.
3. После полного evidence window открывать отдельный sunset PR на каждый legacy entry:
   announcement, callers/fixtures, code/schema, rollback и обновление baseline.
4. Старый transfer удалять только vertical slice целиком, включая route, service,
   repository/table/trigger, permissions и UI caller.

## Проверки и подводные камни

- отсутствие import не доказывает отсутствие ручного запуска;
- физические QR labels живут дольше web clients; fixtures сохранить как архив контракта;
- cookies требуют dual-read window;
- DB migration проверять на production-like rows, не пустой базе;
- historical migration names не переименовывать;
- типы, являющиеся текущими UI view models, не считать legacy по названию.

## Acceptance

У каждого оставшегося legacy entry есть owner/counter/window/decision date; каждое
удаление атомарно, обратимо и подтверждено clean build/tests; `unknown` не заменён
предположением о нулевом usage.

Оценка быстрого orphan cleanup: **7/10**; sunset — только после evidence.
