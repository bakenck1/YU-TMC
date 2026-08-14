# Release checklist

Этот документ разделяет автоматические проверки, которые должны быть зелёными
в CI, и внешние production gates, которые нельзя честно подтвердить локальным
build.

## Automated CI gates

Проверки выполняются в таком порядке:

1. `npm ci` из committed `package-lock.json`;
2. `npm run docs:check`;
3. `npm run lint`;
4. `npm run ui:check`;
5. `npm run db:check`;
6. Compose config validation для mobile и production с non-secret placeholders;
7. PostgreSQL service health и создание двух test roles;
8. `npm run db:migrate -- --target=test` через
   `TEST_DATABASE_MIGRATOR_URL`;
9. `npm run db:smoke -- --target=test` через runtime/migrator URLs;
10. `npm run test:all` с database suites enabled;
11. `npm run storybook:build`;
12. Docker targets `builder`, `migrator`, `worker`, `runner` собираются из
    `Dockerfile.mobile` и проходят native/import/runtime smoke;
13. `npm audit --omit=dev --audit-level=high`;
14. production `npm run build` и `npm run security:check`.

Test database roles разделены:

- `yu_inventory_test_migrator` применяет migrations и владеет schema objects;
- `yu_inventory_test_runtime` используется приложением, имеет только runtime
  grants, не имеет DDL/schema-owner и не пишет migration history;
- deployment ID уникален для GitHub run и не совпадает с development/
  production identity.

CI должен падать, если отсутствует любая из двух database URLs, migration
manifest не совпадает, smoke не видит runtime grants или database suite была
пропущена.

## Manual production gates

Перед production release ответственный инженер отмечает evidence для каждого
пункта:

- [ ] secrets inventory: `SESSION_SECRET`, DB credentials, OAuth, VAPID и
      webhook secrets не находятся в image/repository;
- [ ] DB runtime role и migrator role разделены, grants проверены через
      `db:smoke`;
- [ ] production TLS использует `verify-full` или отдельно одобренный private
      CA; ingress/trusted proxy headers настроены и проверены;
- [ ] backup создан, restore проверен на отдельной target database;
- [ ] staging browser/PWA smoke пройден для login, OAuth, password reset,
      QR, photos и push;
- [ ] authenticated DAST/pentest выполнен с учётом object-level authorization;
- [ ] Docker runtime image собран и просканирован, source maps/secret files
      отсутствуют;
- [ ] нагрузочный smoke и `EXPLAIN` проверены на representative data volume;
- [ ] rollback/runbook протестирован; DB rollback выполняется forward-fix или
      backup restore, а не down migration;
- [ ] graceful `SIGINT`/`SIGTERM` shutdown проверен для app и push worker;
- [ ] production error monitoring и alert routing включены.

Исторический audit report не заменяет свежую проверку. Если manual gate не
может быть подтверждён, release остаётся NO-GO с зафиксированной причиной и
owner follow-up.
