# Security audit — 2026-08-14

## Итог

По исходному коду и локальным проверкам подтверждённых незакрытых IDOR/BOLA-дефектов в проверенном охвате не осталось. Для merge кодовый verdict — **GO**. Для публичного production-релиза verdict остаётся **NO-GO до выполнения внешних P0-проверок**, перечисленных ниже.

## Охват

- Сверены 72 HTTP-метода; 59 маршрутов требуют объектной авторизации.
- Проверены path-, query- и body-идентификаторы, цепочки `route → service → SQL`, push-subscriptions, QR-resolve, вложения, заявки, пользователи, инспекции, инвентарь и TMC transfer requests.
- Server Actions не обнаружены; 17 страниц имеют ID/query/token-поверхность.
- `proxy.ts` намеренно не перехватывает `/api`, поэтому каждый API handler рассматривался как самостоятельная внешняя граница.
- Файлы и фотографии хранятся в PostgreSQL и отдаются авторизованными handlers; публичного bucket или файлового листинга не обнаружено.

## Исправлено и покрыто TDD

- Повторная проверка сессии и текущей роли под транзакционной блокировкой для users, service requests и фото заявки; отзыв/понижение роли между первичной проверкой и чтением теперь закрывает доступ.
- Проверка принадлежности объекта и снимка responsibility в TMC-операциях, включая конкурентные PostgreSQL-сценарии.
- Нейтральные результаты для отсутствующих, чужих и недоступных item/recipient/QR targets, чтобы убрать enumeration oracle.
- Parent-chain authorization для `item → comment → attachment` и binding push endpoint к владельцу.
- Ограниченный body gateway для JSON, multipart/photo и bulk-входов; durable DB rate limiter вместо process-local состояния.
- Fail-closed row budgets на persistence-границе для users, inventory, inspections, service requests, transfers, room workspace, audit и push subscriptions: PostgreSQL получает sentinel `LIMIT`, переполнение не обрезается молча.
- Удаление source maps из production runtime image и invariant в `security-check`.
- Production Next build сам отключает Turbopack/server source maps; Docker cleanup остаётся второй защитой.
- Зафиксированы regression-тесты для auth/session races, ownership, stale objects, concurrency и DTO privacy.

## Доказательства

- `npm run test:all`: 511 серверных тестов, 15 UI-тестов, 41 component test — все passed; PostgreSQL integration из этого запуска пропущен только потому, что `TEST_DATABASE_URL` не задан.
- `npm run test:database:local`: все 6 изолированных PostgreSQL suites passed, включая migration, repositories, ownership/override, push и concurrent transaction tests.
- `npm run build`: Next.js 16.2.11, TypeScript и static generation passed.
- После build: `standalone_maps=0`, `static_maps=0`; `npm run storybook:build` также passed.
- `npm run lint`, `npm run security:check`, `npm run db:check`, `npm run ui:check` — passed.
- `npm audit --omit=dev --audit-level=high --prefer-offline`: 0 vulnerabilities.
- Secret-pattern scan не нашёл credential material в tracked application/runtime scope; `.dockerignore` исключает `.env*`, secret/credential files, `.git`, tests и generated audit/build data.
- `docker compose -f docker-compose.mobile.yml config --quiet` и production compose validation с non-secret placeholder values — passed; production compose требует secrets явно и не имеет permissive defaults.
- `git diff --check`: ошибок whitespace нет; предупреждения относятся к недоступному пользовательскому global git ignore и CRLF normalization.

## Остаточные release-gates

Это не подтверждённые локальным кодовым аудитом BOLA, а внешние или эксплуатационные условия:

1. Выполнить production secret/DB-role/TLS/ingress/backups review, включая trusted-proxy configuration.
2. Выполнить ручную проверку браузера, PWA, OAuth, password reset и push на staging; затем authenticated DAST/pentest.
3. Собрать и просканировать Docker runtime image. Локально Docker daemon недоступен; сам `Dockerfile.mobile` удаляет `.map` перед runtime.
4. Закрыть P1 эксплуатационный backlog: alerting, нагрузочный прогон, `EXPLAIN` для тяжёлых коллекций и rollback/runbook.
5. Отдельно принять решение по продуктовой политике: сотрудник по текущему контракту может сканировать активный чужой инвентарный barcode для запуска transfer request.

Коллекции и экспорты с потенциально большой cardinality всё ещё требуют production capacity review и `EXPLAIN` на реальном объёме данных, но локальный unbounded-read риск закрыт fail-closed budgets; это не найденный IDOR.

Исторические отчёты не переписывались; этот файл фиксирует состояние аудита на 2026-08-14.
