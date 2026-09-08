# P3 — измерить capacity на production-like данных

## Корень долга

В репозитории нет production-like cardinality model, сохранённых PostgreSQL plans и
повторяемого load результата. Поэтому индекс, pagination, streaming или очередь сейчас
были бы оптимизацией по предположению. Исправления внешних API выполняются в задачах
10/12; здесь только измерение и создание доказанных follow-up tickets.

## Measurement slice (M)

1. Согласовать объёмы и SLO/P50/P95: users/items/photos/transfers/events, XML/export,
   одновременные scanners и worker concurrency.
2. Собрать обезличенный versioned dataset и стабильный read-only load script.
3. Снять `EXPLAIN (ANALYZE, BUFFERS)` для inventory list, Dockflow projection,
   TMC history/notifications, asset-loss list и export source query.
4. Измерить pool saturation, statement timeout, worker leasing/graceful shutdown,
   process memory и production Next chunks по routes. Storybook bundle не считать
   proxy для production route.
5. Сохранить компактный report: dataset version, environment, query fingerprint,
   plan summary, baseline и bottleneck. Каждый подтверждённый bottleneck оформить
   отдельной задачей с expected gain/rollback; в measurement PR код не оптимизировать.

## Правила измерения

- PostgreSQL plan не доказывать mock/SQLite;
- mutation `EXPLAIN ANALYZE` выполнять только на disposable staging copy;
- performance threshold — nightly/release signal, не flaky PR unit gate;
- не публиковать raw production dump или PII;
- не вводить cache, index, keyset pagination, streaming/queue без измеренной причины.

## Acceptance

Есть воспроизводимый baseline и ранжированный bottleneck list; каждый предлагаемый
follow-up привязан к метрике, бюджету и rollback. Если bottleneck не найден, задача
закрывается отчётом без speculative changes.

Оценка эффекта: **6/10 до появления реальных объёмов**, затем пересмотреть.
