# P2 — пилот browser smoke для критических journeys

## Сначала решение, затем инструмент

Сейчас browser E2E runner в dependencies/CI не найден. Полный E2E-комбайн даст дорогие
fixtures и flaky gates. Цель пилота — проверить только те стыки browser/session/route/DB,
которые component и route tests не доказывают.

## Рекомендуемый пилот (M)

Два journey на production build и отдельной PostgreSQL test DB:

1. **Login/session:** вход тестового пользователя, доступ к protected page, refresh
   с сохранением сессии, logout и запрет повторного доступа.
2. **Transfer decision:** создать минимальные item/users fixture через поддерживаемый
   test setup, инициировать transfer из UI, принять второй ролью, увидеть новый статус.

QR/camera, file upload, push и asset-loss не включать в пилот. Asset-loss получит UI
smoke только если задача 11 подтвердит, что UI входит в продуктовый scope.

## Оркестрация

1. Выбрать минимальный поддерживаемый runner после короткого spike; один browser engine.
2. Запускать `next build`/production server с уникальным port и явным test env.
3. Создавать disposable DB schema/database, применять migrations и deterministic seed;
   teardown обязан выполняться и после падения.
4. Не использовать production credentials, внешние SSO, реальные email/push/1С; внешние
   границы stub на уровне documented test endpoint/provider.
5. Артефакты при падении: screenshot, trace/log и request ID без secrets.
6. Первые две недели запускать non-blocking в CI, собрать flake/time baseline; сделать
   blocking только при <1% инфраструктурных повторных падений и назначенном owner.

## Подводные камни

- не выбирать элементы по CSS implementation details; использовать role/name/test ID
  только где семантики недостаточно;
- parallel workers не должны делить users/items;
- retries не должны скрывать product failure; повтор помечается отдельно;
- dev server/HMR не является production smoke;
- не расширять до пяти journeys до доказанной стабильности пилота.

## Acceptance

Два journey воспроизводятся локально одной командой и в CI; DB изолирована и очищается;
падение оставляет безопасные артефакты; владелец и политика blocking/retry записаны.

Оценка эффекта: **7/10** после P0/P1 behavioral tests.
