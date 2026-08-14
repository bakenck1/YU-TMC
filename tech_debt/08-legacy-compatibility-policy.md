# P3 — policy для legacy compatibility

## Что намеренно не удаляем сейчас

Legacy QR aliases/URLs, credential import, cookie compatibility claims и
legacy transfer routes описаны как действующие compatibility boundaries.
Удаление без usage evidence может сломать старые наклейки, cookies, импорт или
существующих клиентов.

## Что нужно сделать

Создать compatibility inventory для `legacy.*` permissions, legacy transfer
routes, QR `legacy_raw`/`legacy_url` aliases, legacy credential importer,
старого cookie `{sub,email,name,role,...}` contract и `lib/data.ts` legacy seed
source.

Для каждого entry зафиксировать owner и consumer, дату/причину появления,
security implications, production usage evidence, migration path, критерий
удаления, regression fixture и минимальный срок поддержки.

### Evidence и ownership contract

Owner по умолчанию — maintainer соответствующего домена; release owner
сводит inventory в `docs/legacy-compatibility.md`. Usage evidence берётся из
structured application/request logs и миграционных fixture counts, без записи
секретов и персональных данных. Retention для агрегированных usage counters —
90 дней; если structured telemetry отсутствует, entry помечается `unknown`, а
не объявляется неиспользуемым. Каждая запись получает следующую дату review не
позднее 90 дней после создания.

Sunset decision требует owner, production evidence за 90 дней, migration
announcement и regression run. Если evidence неполно, статус остаётся
`supported`, а compatibility code не удаляется.

## Правила

1. Новые APIs не добавляют `legacy.*`, если ресурс можно назвать текущим
   доменным именем.
2. Existing legacy fixtures продолжают проходить.
3. Compatibility code должен быть import-only/read-only там, где это возможно.
4. Sunset начинается только после telemetry/production inventory и migration
   announcement.
5. Renaming permission без compatibility alias — отдельная migration task, не
   часть cosmetic cleanup.

## Acceptance

Есть inventory, owner, источник evidence, 90-дневная retention/review policy;
новые legacy usages запрещены проверкой или documented exception; QR/auth/
transfer regression tests зелёные; для удаления каждого участка есть
измеримый signal и migration announcement.
