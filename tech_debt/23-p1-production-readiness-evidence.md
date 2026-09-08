# P1 — закрыть внешние production-readiness gates доказательствами

Статус: **Engineering Done (2026-09-08); external gates blocked / NO-GO**.

Реализация: добавлены machine-readable registry, проверяемый release evidence pack и подробный
runbook. Checker связывает application/evidence commits, точный migration journal, deployment и
artifact/registry digests; критические gates и prerequisites не допускают `not-applicable`, а `GO`
требует проверяемые repository artifacts и Ed25519 deployment attestation с заранее закреплённым
public-key fingerprint. Текущий датированный pack остаётся `NO-GO`: staging/production ingress,
restore target, test identities, scanner, production-like capacity data и alert destination не были
предоставлены и честно отмечены `blocked`.

Независимые review-проходы: **5/10**, затем **6/10**. Все actionable findings обоих проходов
устранены; третий проход не выполнялся согласно лимиту в два review. Финальная проверка: 680 server,
15 UI и 72 component tests, production build, lint без ошибок, `docs:check`, evidence checker и
`git diff --check`. PostgreSQL suite локально пропущен без test database URLs; SQL не изменялся.

## Корень долга

Локальные checks зелёные, но это не доказывает свойства deployment environment.
В [security audit](../docs/security-audit-2026-08-14.md) и
[release checklist](../docs/release-checklist.md) остаются ручные/внешние gates:
trusted proxy/TLS, restore backup, staging OAuth/PWA/push, runtime scan, load и rollback.
Без датированного артефакта релизный verdict нельзя воспроизвести.

## Один release evidence pack (M, преимущественно ops)

Owner: release/platform owner; product owners подписывают только свои flows.

1. Зафиксировать commit SHA, deployment ID, environment, migration set, timestamp,
   executor и ссылки/хэши evidence. Secrets и raw production data не прикладывать.
2. Проверить trusted proxy chain, HTTPS redirect/HSTS/cookie flags и невозможность
   подделать forwarded client/request metadata вне доверенного proxy.
3. Выполнить backup restore drill в изолированную БД: RPO/RTO, row counts/checksums,
   ключевые queries и cleanup; наличие backup без restore не считается.
4. На staging проверить реальные OAuth redirect URIs/session/logout, PWA install/update,
   push subscribe/delivery/revoke и documented fallback.
5. Выполнить authenticated DAST/runtime dependency/container scan в согласованном scope;
   findings имеют severity, owner, due date или подписанное risk acceptance.
6. Выполнить capacity smoke по baseline задачи 20 и rehearsal rollback приложения и
   обратимой части migration. Не обещать rollback для необратимого DDL — нужен restore plan.
7. Для alerts определить sink/destination, порог, owner, escalation и runbook; тестовое
   событие должно дойти до человека. Событийный контракт берётся из задачи 14.

## Статусы и зависимости

Каждый gate имеет `pass`, `fail`, `blocked` или `not-applicable` с обоснованием. Нельзя
считать отсутствие доступа/данных успехом. Зависимости: задача 14 для events/alerts,
задача 20 для capacity baseline; остальные проверки могут выполняться независимо.

## Acceptance

Для конкретного deployment существует неизменяемый/датированный evidence pack; каждый
gate имеет результат и owner; критический fail блокирует release; повтор проверки можно
выполнить по командам/runbook без устных знаний.

Оценка эффекта: **9/10 перед production release**; это не рефакторинг приложения.
