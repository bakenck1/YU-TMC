# P2 — единые внутренние HTTP boundary primitives

## Корень долга

Во внутренних route handlers повторяются auth, JSON parsing, Zod/error mapping,
cache headers и request context. Три legacy ID handlers отдельно вызывают
`normalizeTransferId`. Это создаёт drift, но массовый rewrite 74 routes опаснее долга.
Внешние 1С/Dockflow contracts сюда не входят: их правила определяют задачи 10 и 12.

## Минимальный первый slice (S–M)

1. Выбрать одно внутреннее семейство из трёх legacy ID handlers и зафиксировать
   table-driven route tests: malformed ID, unauthenticated, forbidden, not found,
   domain conflict, unexpected error и no-store.
2. Ввести маленькие pure helpers только для parse ID, internal error mapping и
   no-store response. Auth/application service остаются явными в handler.
3. Мигрировать выбранные три routes без изменения status/body/headers; сравнить
   контракт до/после теми же тестами.
4. Добавить узкий architecture/source guard против локальной копии этих helpers.

## Дальнейшее применение

Расширять helper только при втором реальном consumer. Для upload, streaming, XML,
binary/QR и внешних API оставлять специализированную boundary. Не создавать universal
route factory, middleware DSL и скрытую dependency injection.

## Подводные камни

- порядок должен оставаться parse/auth/authorize/use case согласно текущему контракту;
- `401`, `403`, `404`, `409`, `413`, `422`, `429` не сводить к общему `400`;
- unexpected errors не должны раскрывать message/cause;
- correlation ID и logging согласовать с задачей 14, но не блокировать первый slice;
- не менять cache semantics и wire shape в cleanup PR.

## Acceptance

Три выбранных handler используют общие primitives; все table cases подтверждают
полную эквивалентность; новый route получает статически проверяемый шаблон; внешние
contracts и остальные routes не затронуты.

Оценка эффекта: **7.5/10**.
