# Release evidence pack

Production verdict хранится в отдельном JSON-файле для конкретного deployment. Он содержит только
безопасные метаданные и ссылки с SHA-256; secrets, скриншоты с production data и сырые логи в pack
не добавляются.

Проверка:

```bash
npm run release:evidence:check -- --file release-evidence/<deployment-id>.json
```

Обязательные metadata: полный commit SHA, deployment ID, environment, UTC timestamp, executor и
точный набор применённых migration tags из `drizzle/meta/_journal.json`. Gate registry и владельцы
зафиксированы в `scripts/release-evidence-gates.json`.

Каждый gate получает `pass`, `fail`, `blocked` или `not-applicable`. `pass` требует хотя бы одну
immutable evidence reference: repository-relative sanitized artifact, SHA-256 содержимого и время
получения. Repository evidence читается из дерева `release.evidenceCommitSha`, а не из текущего
worktree; непроверяемые remote URL запрещены.
Остальные статусы требуют rationale. Все текущие gates критические и требуют `pass`: для них
`not-applicable` запрещён. Отсутствие доступа, staging credentials или release environment
остаётся `blocked` и даёт `NO-GO`.

Минимальный gate set: trusted proxy/TLS; изолированный backup restore drill; staging auth/PWA/push;
authenticated runtime scan; capacity smoke; rollback rehearsal; доставка тестового alert человеку.
Capacity gate зависит от prerequisite `tech-debt-20-capacity-baseline`, alert delivery — от
`tech-debt-14-events`. Оба prerequisite имеют свой owner/status/evidence и обязаны иметь `pass`
до `GO`; текстовое упоминание зависимости не считается подтверждением.

`GO` дополнительно требует `artifactSha256`, digest активного gate registry и Ed25519 signature над
каноническим полным pack. Public SPKI key передаётся только через доверенную среду проверки в
`RELEASE_EVIDENCE_PUBLIC_KEY_SPKI`, его key ID должен совпадать с registry. Так deployment ID,
application commit/artifact, evidence commit, gates и verdict образуют одну подписанную аттестацию.
SHA-256 DER public key обязан быть заранее закреплён в `signingPublicKeySha256`; значение
`UNCONFIGURED` намеренно запрещает `GO`, пока release owner не внесёт fingerprint отдельным
reviewed change. Test-only key override принимается только при `NODE_ENV=test`.
`NO-GO` pack подписи не требует и может хранить `artifactSha256: null`: он ничего не разрешает и
не должен выдумывать digest ещё не собранного deployment artifact.

Текущий append-only snapshot — `release-evidence/local-2026-09-10-no-go.json`.
Он подтверждает repository prerequisites для event contract и capacity baseline,
но не подменяет ими семь deployment-specific gates; поэтому verdict остаётся `NO-GO`.

## Gate runbook

Команды выполняются release owner в согласованной среде. Вывод сначала сохраняется во временный
закрытый каталог, очищается от production identifiers, публикуется в immutable artifact storage и
только затем получает SHA-256. Код возврата и digest входят в evidence; устное подтверждение не
считается.

| Gate | Воспроизводимая проверка | Обязательное содержание evidence |
| --- | --- | --- |
| `trusted-proxy-tls` | `curl --proto '=https' -sS -D headers.txt -o /dev/null https://<staging>/login`; повторить с forged `X-Forwarded-For`, `X-Forwarded-Proto` и `X-Request-Id` снаружи proxy | redirect/HSTS/cookie flags, фактически увиденный server request ID; forged metadata не принимается |
| `backup-restore` | `pg_restore --list <dump>`; создать отдельную пустую БД с уникальным именем `yu_restore_drill_<timestamp>`; направить `TEST_DATABASE_URL` и `TEST_DATABASE_MIGRATOR_URL` строго на неё; до restore записать `select current_database(), current_user`; выполнить `pg_restore --exit-on-error --no-owner --no-privileges --dbname="$TEST_DATABASE_MIGRATOR_URL" <dump>`, затем снова подтвердить identity обеих ролей и выполнить `npm run db:smoke -- --target=test` | restore exit status, точное имя isolated DB и обе роли, backup timestamp, RPO/RTO, sanitized row counts/checksums, smoke и cleanup result |
| `staging-auth-pwa-push` | вручную пройти local/OAuth login, logout и password reset; установить PWA, проверить update; subscribe, доставить тестовый push, revoke и проверить fallback | browser/OS, deployment ID, timestamp и подписанные product-owner результаты без account data |
| `authenticated-runtime-scan` | запустить одобренный DAST/runtime scanner против staging с выделенной test identity | tool/version/scope, findings с severity/owner/due date либо signed risk acceptance |
| `capacity-smoke` | выполнить утверждённые task-20 scenarios на production-like cardinality | dataset cardinality, concurrency, latency/error percentiles и пороги verdict |
| `rollback-rehearsal` | развернуть предыдущий application artifact; для обратимой migration выполнить утверждённый down/forward-fix path, для необратимой — restore drill | deployment timeline, RTO, health/smoke result и выбранная DB recovery strategy |
| `alert-delivery` | подать тестовый structured error через утверждённый sink и пройти escalation | destination, threshold, on-call owner, delivery/ack timestamps и ссылка на runbook |

Замените placeholders (`<staging>`, `<dump>`) только в операторской копии команды. Credentials не
должны попадать ни в shell history, ни в evidence; используйте environment/secret store конкретного
scanner или сервиса. Cleanup базы выполняется только после повторного `select current_database()`
через обе test URL, сверки точного префикса `yu_restore_drill_`, отключения test clients и отдельного
подтверждения release owner. В evidence записывается очищенный cleanup result; исходный backup не
удаляется.

Raw evidence рекомендуется хранить в access-controlled immutable CI/artifact storage. В Git
добавляется только очищенная аттестация без identifiers/secrets; checker сверяет её bytes с digest
из pack на `release.evidenceCommitSha`. Перед добавлением вычислите digest (`sha256sum <file>` или
`Get-FileHash -Algorithm SHA256`), а локальную сырую копию затем удалите по утверждённой политике.
