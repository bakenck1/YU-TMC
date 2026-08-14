# Technical debt backlog

Этот каталог содержит исполнимый backlog технического долга. Задачи
отсортированы по приоритету, а не по размеру diff: сначала закрываются риски,
которые могут пропустить сломанный релиз или дать недостоверный operational
сигнал, затем поддерживаемость и compatibility-policy.

## Baseline

На момент составления backlog:

- `npm.cmd run lint` проходит;
- `npm.cmd run ui:check` проходит;
- `npm.cmd run test:all` проходит: 511 server tests, 15 UI tests и 41 component
  test;
- PostgreSQL integration suites локально пропускаются без `TEST_DATABASE_URL`,
  а в CI запускаются при наличии CI credentials;
- P0-проблем не найдено;
- независимый baseline-review оценил состояние на 7/10.

Зелёный baseline не означает отсутствия долга: часть рисков относится к
release-процессу, multi-instance deployment и доказательству coverage.

## Порядок

| Приоритет | Задача | Результат | Сложность |
| --- | --- | --- | --- |
| P1 | [CI и release gates](01-ci-release-gates.md) | CI проверяет критический автоматический release-контур и явно отделяет ручные gates | M |
| P1 | [Settings persistence](02-settings-persistence.md) | settings имеют честную multi-instance гарантию либо deployment жёстко ограничен одной инстанцией | L / decision |
| P2 | [Monitoring window](03-monitoring-window.md) | отчёт показывает фактическое окно сбора ошибок | S |
| P2 | [Node/Docker reproducibility](04-node-docker-reproducibility.md) | CI и production используют совместимый, lockfile-based toolchain | M |
| P2 | [Documentation drift](05-documentation-drift.md) | README/docs/TASKS ведут на существующие команды и пути | S |
| P2 | [God services/components](06-god-services-components.md) | крупные units разделяются по стабильным workflow seams без смены доменных правил | L |
| P2 | [Functional test coverage](07-functional-test-coverage.md) | критичные вертикали имеют доказуемые contract/integration/UI tests | M |
| P3 | [Legacy compatibility policy](08-legacy-compatibility-policy.md) | legacy-код имеет owner, usage evidence и sunset criteria | M |
| P3 | [Audit repository policy](09-audit-repository-policy.md) | исторические audit/generated материалы имеют понятную политику хранения | S / decision |

## Near-term versus hard/optional

Near-term: `03`, `05`, `01`, `04`, затем `07`. Эти изменения маленькие или
локализованные и дают максимальный эффект без переписывания домена.

Hard/optional: `02`, `06`, `08`, `09`. Они требуют решения о deployment model,
границах модулей или хранении исторических материалов. Их нельзя закрывать
механическим удалением compatibility-кода.

## Общие правила реализации

1. Сначала добавить или уточнить failing test/validation contract, затем менять
   код.
2. Не переносить authorization из server/application слоя в UI.
3. Не менять доменные правила одновременно с механическим extraction, если это
   не является причиной задачи.
4. Не удалять legacy-форматы, cookie claims, QR aliases или import paths без
   production usage evidence и migration plan.
5. После каждой задачи запускать targeted checks, полный релевантный suite и
   независимый read-only review без контекста предыдущих обсуждений.
6. В commit попадают только файлы текущей задачи. Существующие изменения в
   `loop-code-review-skill/` не принадлежат этому backlog.
