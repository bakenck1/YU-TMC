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
