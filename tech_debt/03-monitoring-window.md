# P2 — фактическое окно production-error monitoring

## Evidence

`scripts/monitor-production-errors.mjs` принимает произвольный положительный
`--since-minutes`, но renderer отчёта записывает hard-coded default вместо
фактически использованного значения. Поэтому отчёт для `--since-minutes 5`
может утверждать, что source window равен 30 минутам.

Тестов CLI/report generation сейчас нет.

## Изменение

1. После parsing CLI сохранить одно нормализованное `sinceMinutes`.
2. Передать его в renderer/summary builder явно, не читать default повторно.
3. Записывать фактическое окно в report metadata и human-readable output.
4. Не менять aggregation/merge semantics и occurrence counts.
5. Сохранить default 30 минут для команды без аргумента.

### Формат совместимости

Новое поле front matter — `source_window_minutes: <positive integer>`. Старые
incident markdown files без этого поля считаются legacy reports с effective
window `30` только при отображении; они не переписываются автоматически. Merge
не смешивает metadata разных запусков: каждый новый incident report содержит
окно текущего запуска, а persisted known state хранит только counters/timestamps
как раньше.

## TDD

- custom `5` → report `source_window_minutes: 5`;
- default → `30`;
- custom `60` → `60`;
- invalid/zero/negative input остаётся rejected;
- no-error run не уничтожает persisted state;
- merge двух запусков сохраняет фактические metadata каждого запуска.
- старый report без поля читается как legacy/default и не ломает parser;
- новый report fixture содержит front matter и expected rendered lines.

## Подводные камни

- Не брать число из display string.
- Не менять временную зону и границы `since`/`until` попутно.
- Не переписывать старые incident reports задним числом.
- Проверить JSON и текстовый output, если они формируются разными функциями.

## Acceptance

CLI и report metadata говорят об одном и том же реально обработанном окне;
focused test запускается без production credentials; полный monitoring script
не меняет существующие incident counts.

## Status: Done

Реализовано в `scripts/monitor-production-errors.mjs`: фактический
`sinceMinutes` передаётся в каждый report renderer. Добавлены black-box tests на
custom/default window, несколько incident reports и no-error state behavior.

Validation: `node --import ./scripts/node-userinfo-workaround.mjs --import tsx
--test tests/monitor-production-errors.test.ts`, `npm.cmd run lint` и
`npm.cmd run test:all` проходят. Independent review: 10/10, test quality 10/10,
no actionable findings.
