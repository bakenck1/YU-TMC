# P2 — документационный drift и starter-template residue

## Evidence

Документы содержат команды и пути, которых нет в текущем проекте:

- `docs/database.md` упоминает `npm run test:db`, но script отсутствует;
- `TASKS.md` упоминает `npm test`, но script отсутствует;
- `README.md` предлагает редактировать `app/page.tsx`, которого нет;
- README всё ещё описывает generic `create-next-app` проект;
- package name остаётся `my-next-app`.

## Изменение

1. Переписать README как onboarding для YU Inventory: prerequisites,
   embedded/external PostgreSQL paths, `.env` separation, dev/test/build/
   security/UI/database commands, mobile Docker runtime, auth/SSO/push setup и
   ссылка на release checklist.
2. Заменить stale commands в `docs/database.md` и `TASKS.md` на реально
   существующие scripts: `npm run test:all`,
   `npm run test:database:local`, `npm run db:check` и остальные актуальные
   команды.
3. Удалить или переписать starter-template text и ссылки.
4. Решение о смене package name принять отдельно: если name используется
   внешней automation, сохранить его и документировать; иначе переименовать.
5. Добавить лёгкий docs consistency checker, который проверяет только commands
   и явно перечисленные local paths, без хрупкого NLP.

## TDD/validation

- каждый документированный `npm run X` существует в `package.json`;
- каждый документированный source path существует;
- clean-checkout onboarding достигает running dev server;
- checker не падает на исторических audit files и примерах чужих команд.

## Подводные камни

- Не переписывать исторические security audit snapshots.
- Не обещать Docker, если embedded local path — официальный default.
- Не добавлять alias scripts только ради маскировки устаревшей документации.
- Сохранить русскую/английскую информацию, не смешивая operational source of
  truth с PRD history.

## Acceptance

Новый разработчик по README запускает проект, тесты и database checks без
несуществующих команд; docs checker зелёный; package-name решение зафиксировано.
