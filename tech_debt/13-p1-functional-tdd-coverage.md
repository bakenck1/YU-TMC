# P1 — выровнять функциональное TDD-покрытие

Статус: **Done (2026-09-08)**.

Решение: матрица покрытия теперь связывает production-вертикали и инварианты с
route/application/PostgreSQL/component/browser evidence и честно отмечает пробелы.
Крупные TMC service и PostgreSQL transaction suites разбиты по use case с общими
fixtures без изменения 55 service- и 6 database-сценариев. `test:all` явно выводит
`ran/skipped` для `unit-route`, `ui`, `component` и `postgresql`, а CI запрещает
пропуск обязательного PostgreSQL-контура. Независимые ревью: **9/10**, затем
**10/10**; единственное замечание первого прохода о drift названий test lanes в
документации устранено.

## Корень долга

Матрица тестов не включает новые вертикали: asset-loss, локальные штрихкоды,
decommissioned-in-use, 1С inbox и внешний `/api/v1`. Из 159 test-файлов 64 читают
исходный текст (воспроизводимо: `rg -l "readFileSync|readFile\\(|source\\.includes|readSource" tests | Measure-Object`).
Такие проверки полезны для архитектурных запретов и CI wiring, но не доказывают
runtime-семантику auth, лимитов, транзакций и обработки ошибок.

## Минимальный план

1. Составить таблицу `vertical × invariant × evidence level`: route, application,
   PostgreSQL, component, browser. Для каждого инварианта выбрать один основной слой.
2. Сначала закрыть отсутствующие проверки из задач 10 и 11: auth/BOLA, лимит тела,
   rollback/race, повтор запроса и безопасная ошибка.
3. У каждого source-based security test, который проверяет порядок auth, body limit,
   cache header или unexpected error, добавить ровно один behavioral counterpart.
4. Разбить `tmc-transfer-request-service.test.ts` (2111 строк) и database transaction
   suite (1186 строк) по use case, переиспользуя fixtures; поведение не менять.
5. В CI summary явно показывать ran/skipped для unit, component и PostgreSQL suites.
6. Browser smoke не смешивать с этой задачей: решение и пилот вынесены в
   [22-p2-browser-smoke.md](./22-p2-browser-smoke.md).

## TDD-шаблон

1. Зафиксировать observable contract одним падающим regression test.
2. Сделать минимальное изменение; extraction начинать с characterization test и
   move-only diff, а изменение поведения — отдельным коммитом/PR.
3. SQL race проверять двумя соединениями PostgreSQL, не fake callback.
4. UI проверять по role/name/user action, не по полному snapshot или CSS-строке.

## Антицели и подводные камни

- не вводить глобальный процент покрытия и не переписывать все 64 source tests;
- не поднимать browser/DB для каждого unit test;
- не дублировать один invariant на пяти слоях;
- skipped обязательной suite должен быть ошибкой CI, локальный opt-in — явно обозначен;
- fake repository не доказывает блокировки, constraints и rollback PostgreSQL.

## Acceptance

Матрица перечисляет все production verticals и честные gaps; P0 workflows имеют
route/application/PostgreSQL evidence; source-test не является единственным
доказательством динамической безопасности; test output различает ran/skipped.

Оценка эффекта: **9/10**. Размер: **M**, после задач 10–12.
