# P3 — policy для `_audit/` и generated history

## Долг

Tracked repository содержит substantial `_audit/` materials и большие Drizzle
snapshots. Это полезная история, но она увеличивает clone/review noise и
размывает границу product source, generated metadata и immutable evidence.

Docker уже исключает audit/docs/tests из runtime context, поэтому проблема — не
runtime leak, а ownership, navigation, retention и provenance.

## Варианты решения

## Принятое решение

До отдельного external archive `_audit/` остаётся в основном репозитории как
immutable evidence. Для каждого нового audit report обязательны дата, scope,
commit SHA и validation commands. Historical reports не редактируются; новые
исправления добавляются новым dated report.

Владелец policy — repository maintainer. Следующая ревизия — через 90 дней.
Решение о переносе принимается по критериям: размер clone, доступ reviewer,
legal/security retention, backup/restore verification и наличие immutable
provenance. Любой перенос требует сохранённого hash/index и проверочного restore
до удаления tracked copy.

### Оставить в основном репозитории

- добавить ownership и retention policy;
- отделить generated files в README/index;
- не редактировать historical reports задним числом;
- проверять, что audit artifacts не попадают в production image.

### Вынести в immutable storage

- сохранить hash, даты, scope и ссылку в репозитории;
- обеспечить доступ reviewer/deployer;
- сохранить provenance до удаления tracked copy;
- описать backup/retention.

### Гибрид

Оставить release-critical summary и index, а полные артефакты хранить отдельно.

## Acceptance

Владелец репозитория зафиксировал выбранную policy и дату пересмотра; audit evidence не теряется;
generated snapshots остаются согласованными с migrations; Docker/security
checks подтверждают отсутствие лишних материалов в runtime.

## Status: Done

### Реализация

- Выбран и зафиксирован вариант «оставить evidence в основном репозитории до
  отдельного решения об archive»: исторические отчёты не переписываются,
  новые отчёты добавляются датированными append-only файлами.
- Добавлен каталог [`docs/repository-artifacts.md`](../docs/repository-artifacts.md)
  с owner, retention, review date `2026-11-12`, provenance SHA для каждого
  отчёта, правилами нового audit report и критериями external archive.
- Добавлены machine-readable baseline и `npm run artifacts:check`. Gate
  проверяет каталог reports, даты и SHA, pinned audit gitlink и `.gitmodules`,
  90-дневное review window, CI/README/docs wiring, Docker context/runtime
  exclusions, tracked generated artifacts и SQL/journal/snapshot mapping.
- Drizzle raw-SQL-only migration
  `20260808120000_security_resource_quotas` зафиксирована как единственное
  объяснённое исключение без generated snapshot; SQL и journal entry всё равно
  обязательны.
- Добавлен contract test, `.gitmodules`, exclusions для Storybook/probe/
  TypeScript build output и усилен `security:check` для audit/docs/tests.

### Validation

- `npm.cmd run test:all`: 552 server, 15 UI и 41 component tests passed;
  PostgreSQL integration skipped без paired test credentials.
- `npm.cmd run artifacts:check`, `docs:check`, `lint`, `ui:check`,
  `security:check`, `db:check`, `npm.cmd run build` и `git diff --check` passed.
- Два fresh independent review-agent прохода были запущены без контекста
  предыдущего диалога. Оба зависли на статусе `running` и не вернули оценку;
  после двух попыток были остановлены по лимиту проходов. Поэтому score
  sub-agent честно не фиксируется как выданный; реализация выровнена по
  локальным проверкам и ручной проверке acceptance, без третьего прохода.

### Осознанные границы

- Docker image build и external archive restore требуют CI/staging environment;
  локально подтверждены context rules, production security gate и Next build.
- Перенос `_audit/` не выполнялся: до измерения clone cost, проверки доступа,
  backup/restore и legal/security retention удаление tracked evidence было бы
  необратимым и нарушило бы provenance.
