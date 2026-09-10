# Technical debt backlog

Этот каталог — исполнимый backlog, а не список пожеланий. Приоритет определяется
риском для данных, безопасности и релиза, затем стоимостью ежедневных изменений.
Зелёный build сам по себе не закрывает долг: проверка должна доказывать нужное
поведение на правильной границе.

## Baseline аудита 2026-09-08

- production build, `db:check`, `ui:check`, `docs:check`, `legacy:check`,
  `artifacts:check`, `security:check` и Storybook build проходят;
- `npm run test:all`: 631 server, 15 source/UI и 72 component tests прошли;
- локальный PostgreSQL-контур: 11 test files прошли;
- `npm audit --omit=dev --audit-level=high`: 0 известных production-уязвимостей;
- lint: 0 ошибок и 3 warnings, один из них в основном `ItemsTable.tsx`, два — в
  локальном `.tmp-dockflow-deploy/`;
- 159 test files, из которых 64 читают исходный текст. Такие проверки полезны
  для архитектурных invariants, но не заменяют выполнение route/service/SQL;
- самые крупные production units: `schema.ts` — 2797 строк, `i18n.ts` — 2565,
  два application service — более 2000 каждый, `InventoryItemDetails.tsx` —
  1345 строк и 41 state declaration, два PostgreSQL adapter — более 1000 строк;
- PostgreSQL остаётся источником истины, но 1С, Dockflow и asset-loss частично
  обходят документированную цепочку `route -> application -> port -> adapter`.

## Приоритетный порядок

| Порядок | Приоритет | Задача | Эффект | Размер |
| ---: | --- | --- | --- | --- |
| 1 | P0 | [Безопасный ingestion 1С — Done](10-p0-one-c-ingestion-hardening.md) | Закрыты unbounded body, утечка DB errors и недоказанная запись | M |
| 2 | P0 | [Asset-loss vertical slice — Done](11-p0-asset-loss-vertical-slice.md) | Закрыты ABA ответственности, lifecycle квитанций, audit chain и coverage | L |
| 3 | P1 | [Периметр внешних API — Done](12-p1-external-api-boundaries.md) | Выровнены Dockflow/1С auth, errors, limits и observability | M |
| 4 | P1 | [Функциональное покрытие и TDD — Done](13-p1-functional-tdd-coverage.md) | Убирает ложную уверенность зелёного source-text suite | M |
| 5 | P1 | [Structured observability и legacy evidence — Engineering Done; evidence gate active](14-p1-observability-and-legacy-evidence.md) | Код закрыт; честный 90-day production interval завершится не раньше 2026-11-12 | M, operational gate |
| 6 | P1 | [Production-readiness evidence — Engineering Done; external gates blocked](23-p1-production-readiness-evidence.md) | Проверяемый pack готов; production verdict остаётся NO-GO без внешних evidence | M / operational |
| 7 | P1 quick win | [Repository/dependency hygiene — Done](21-p1-repository-hygiene.md) | Убраны warnings, scratch noise и лишние зависимости | S |
| 8 | P2 | [Минимальный browser smoke — Done](22-p2-browser-smoke.md) | Проверяет 2 критических пути в собранном приложении | M / decision |
| 9 | P2 | [Декомпозиция application services — Done](15-p2-application-service-decomposition.md) | Первый cohesion-seam извлечён; остальные зафиксированы trigger-only | L, incremental |
| 10 | P2 | [Декомпозиция god-components — Done](16-p2-god-components.md) | Comments workflow изолирован и покрыт component tests | L, incremental |
| 11 | P2 | [Единый HTTP contract — Done](17-p2-http-boundary-consistency.md) | Общий узкий boundary выровнял ID/error/cache contract трёх legacy handlers | M |
| 12 | P3 | [Legacy и рудименты — Done](19-p3-legacy-and-dead-code.md) | Доказанный orphan удалён; шесть legacy boundaries остаются под evidence policy | S–M |
| 13 | P3 trigger-only | [Schema, contracts и i18n — Done](18-p3-schema-contract-i18n-modules.md) | TMC command DTO локализованы после подтверждённого change-frequency trigger | L, optional |
| 14 | P3 | [Capacity и производительность — Done](20-p3-capacity-and-performance.md) | Зафиксирован capacity-v1; пять измеренных bottleneck вынесены в follow-up | M |
| 15 | P1 | [Inventory/export collection capacity — Done](27-p1-inventory-collection-capacity.md) | 25 000 строк читаются keyset-порциями; overflow завершается явной ошибкой | L |
| 16 | P2 | [Pool saturation — Done](24-p2-capacity-pool-saturation.md) | P95 252.83 мс при 16 запросах без увеличения pool | M |
| 17 | P2 | [Export memory — Done](25-p2-capacity-export-memory.md) | RSS growth 89.34 MiB на 25 000 строк при сохранённом XLSX-контракте | M |
| 18 | P3 | [Dockflow projection — Done](26-p3-capacity-dockflow-projection.md) | Два repeat baseline: P95 56.14 и 47.50 мс при бюджете 250 мс | S–M |
| 19 | P2 | [Inventory/export list projection](28-p2-inventory-list-projection.md) | Снижает P95 inventory/export keyset-форм ниже 750 мс | M |

## Два этапа

### Этап 1 — максимальный ближайший результат

Выполнять `10 -> 11 -> 12 -> 13 -> 14 -> 23`, затем быстрый `21` и только те
узкие extraction из `15–17`, которых касается ближайшая продуктовая работа.
`22` автоматизировать после выбора 1–2 journeys. Эти задачи закрывают реальные
blind spots без полного rewrite.

### Этап 2 — сложное и необязательное

`18` и `20` требуют отдельного решения: механическое дробление schema/i18n без
частых конфликтов не окупится, а performance-изменения нельзя проектировать без
production-like cardinality и `EXPLAIN (ANALYZE, BUFFERS)`. Полная ликвидация
legacy из `19` возможна только после evidence window.

## Production-readiness вне code review

Локальный backlog не объявляет production готовым. Незакрытые trusted proxy/TLS,
backup/restore, staging OAuth/PWA/push, DAST/runtime scan и load/rollback gates из
[`docs/security-audit-2026-08-14.md`](../docs/security-audit-2026-08-14.md) и
[`docs/release-checklist.md`](../docs/release-checklist.md) собраны в задаче `23`.

## Правила выполнения

1. Сначала минимальный failing behavioral test, затем минимальная правка.
2. Extraction и изменение бизнес-правила не смешиваются в одном PR.
3. Authorization, session-version recheck, CAS и transaction boundary остаются
   на сервере; UI не становится источником прав.
4. SQL-гарантия доказывается PostgreSQL-тестом, HTTP-гарантия — выполнением
   handler, UI-состояние — component/browser test. Grep допустим только для
   статического architecture contract.
5. Legacy не удаляется по grep: нужны owner, usage evidence, announcement,
   rollback и отдельная задача sunset.
6. Не создавать generic abstraction до двух реальных одинаковых consumers.
7. После задачи: focused suite, `test:all`, PostgreSQL suite при изменении SQL,
   lint, build и профильная проверка. Исторические audit-файлы не переписывать.

## Уже закрытые исторические задачи

Файлы `01–09` сохраняются как журнал принятых решений. Их статус `Done` не
означает, что близкая тема навсегда закрыта: новый код 1С/asset-loss появился
после части этих ревью и создал новые конкретные границы, описанные выше.
