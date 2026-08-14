# P2 — функциональное покрытие и TDD-контуры

## Цель

Не гнаться за процентом покрытия и не дублировать уже сильный BOLA/transaction
suite. Нужна матрица, которая отвечает: какая критичная вертикаль доказана,
каким тестом и что произойдёт при regression.

## Текущий пробел

Часть application services не имеет одноимённых прямых test files, хотя может
быть покрыта route/repository tests. Особенно проверить:

- `idempotent-command-service`;
- `inventory-location-service`;
- `qr-resolution-service`;
- `room-workspace-service`;
- monitoring script;
- settings persistence boundary.

Сначала построить inventory всех public methods и существующих indirect tests;
добавлять тест только если он проверяет новый observable contract или закрывает
реальный blind spot.

## Матрица

Для каждой вертикали отметить happy path, malformed/unknown input,
authorization/ownership, stale/version/race, transaction rollback,
empty/loading/error/retry UI state, privacy/DTO projection и database
integration, если гарантия зависит от SQL.

Критичные verticals: auth/session, inventory item, QR, responsibility,
inspection, transfer/TMC, service requests, photos/attachments, push/outbox,
settings и monitoring.

## Реализация

1. Добавить coverage matrix в `docs/test-coverage.md`.
2. Добавить только недостающие focused tests.
3. Для route tests использовать server boundary и authenticated actor, не
   мокать результат тестируемого service.
4. Для repository guarantees использовать PostgreSQL integration suite.
5. Для components проверять user-visible behavior и accessibility, не snapshot
   всей разметки.
6. Для flaky/slow suites явно разделить fast unit, component и database jobs.

## Подводные камни

- 100% line coverage не доказывает authorization или transaction rollback.
- Не копировать 511 существующих tests в новые unit files.
- Не превращать integration test в implementation-detail test.
- Не делать local development зависимым от Docker.

## Acceptance

- каждая critical mutation имеет contract test;
- каждый public route покрывает auth, validation и unexpected failure mapping;
- database invariants тестируются через PostgreSQL;
- UI critical states покрыты без brittle snapshots;
- matrix показывает coverage и осознанные exclusions;
- CI запускает обязательные suites и различает skipped/ran.
