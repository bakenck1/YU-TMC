# P1 quick win — repository и dependency hygiene — Done

## Статус на 2026-09-09

- удалён неиспользуемый `itemDetails`, а lint теперь завершает CI с ошибкой при любом warning;
- `.tmp-dockflow-deploy/` точечно исключён из Git, ESLint и TypeScript, а
  `.data/postgres-development.log` — только из Git; пользовательские артефакты не удалялись;
- подтверждено отсутствие source/config/dynamic consumers, после чего `recharts` и
  `swagger-ui-react` последовательно удалены из manifest и lockfile; orphan type shim удалён;
- clean install, production build, Storybook build, lint и полный test suite прошли;
  PostgreSQL integration штатно пропущен без пары test database URL, SQL не менялся;
- независимые review-проходы: **9/10**, затем **10/10** после усиления regression-теста;
  итог — no actionable findings.

Свежий `npm audit` отдельно сообщает об advisories для неизменённых `next@16.2.11` и
`sharp@0.35.3`; reviewer подтвердил, что это отдельное обновление зависимостей, а не
регрессия и не блокер этой cleanup-задачи.

## Evidence

- lint предупреждает об unused `itemDetails` в `components/ItemsTable.tsx`;
- `.tmp-dockflow-deploy/` попадает в lint/typecheck scope и дублирует предупреждения;
- `.data/postgres-development.log` не игнорируется;
- direct dependencies `recharts` и `swagger-ui-react` не найдены в source imports,
  но dynamic/config usage ещё нужно исключить.

## Минимальные правки (S)

1. Удалить действительно unused binding либо использовать только при наличии UI contract;
   warning не подавлять.
2. Определить один корень deploy/scratch artifacts и добавить точные ignore/exclude
   patterns; не использовать широкий `*.tmp` и не удалять пользовательские файлы.
3. Игнорировать конкретный development log либо переместить его в уже игнорируемый
   runtime directory; не игнорировать всю `.data/` с fixtures.
4. После очистки сделать lint warnings ошибкой CI.
5. Для `recharts` и `swagger-ui-react`: проверить source/config/dynamic imports и lock
   usage; удалять по одному direct package с lockfile update, clean install, build,
   Storybook и full tests. Transitive packages вручную не чистить.
6. Проверить `tsconfig`/lint scope: локальная копия проекта не компилируется как часть app.

## Подводные камни

- untracked `.tmp-dockflow-deploy/` и log принадлежат пользователю: задача меняет правила,
  но не удаляет эти артефакты;
- package может грузиться через config/dynamic string — одного `rg` недостаточно;
- compatibility package name `my-next-app` уже документирован и не относится к cleanup;
- `skipLibCheck` не менять в этом PR.

## Acceptance

Clean checkout даёт lint без warnings; runtime/scratch не загрязняет status и checks;
неиспользуемые direct dependencies либо удалены с полным evidence, либо помечены
используемыми с конкретным consumer; build/Storybook/tests зелёные.

Оценка эффекта: **7/10 при малой стоимости**; сделать до крупных refactors.
