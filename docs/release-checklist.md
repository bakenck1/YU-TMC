# Release checklist

Этот список разделяет автоматические проверки CI и обязательные действия при
релизе YU Inventory без Docker.

## Automated CI gates

Проверки выполняются в следующем порядке:

1. `npm ci` из committed `package-lock.json`;
2. `npm run docs:check`, `npm run legacy:check` и `npm run artifacts:check`;
3. `npm run lint`, `npm run ui:check` и `npm run db:check`;
4. создание изолированных PostgreSQL runtime и migrator ролей;
5. `npm run db:migrate -- --target=test`;
6. `npm run db:smoke -- --target=test`;
7. `npm run test:all`;
8. `npm run storybook:build`;
9. `npm audit --omit=dev --audit-level=high`;
10. production `npm run build` и `npm run security:check`.

## Manual production gates

Перед релизом ответственный инженер подтверждает:

- [ ] Node.js 22.x и PostgreSQL 16+ установлены на сервере;
- [ ] секреты находятся в `/etc/yu-inventory/yu-inventory.env` с правами `0600`, а не в Git;
- [ ] runtime-роль и migrator-роль БД разделены; `npm run db:smoke -- --target=production` проходит;
- [ ] PostgreSQL подключён с TLS (`verify-full`), а Nginx корректно задаёт доверенный IP-клиента;
- [ ] создан бэкап БД и проверено восстановление на отдельной БД;
- [ ] выполнены миграции и разовый import настроек до запуска новой версии;
- [ ] systemd-сервисы `yu-inventory` и `yu-inventory-push-worker` работают;
- [ ] Nginx отдаёт приложение по HTTPS, загрузка фото и QR-потоки проверены;
- [ ] мониторинг доступности, свободного места и ошибок включён;
- [ ] выполнен staging smoke для login, OAuth, password reset, QR, фото и push;
- [ ] rollback/runbook проверен: для БД используется forward-fix или restore бэкапа.

Если любой пункт нельзя подтвердить, релиз остаётся NO-GO до устранения причины.
