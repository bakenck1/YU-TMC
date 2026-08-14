# P2 — единый Node/Docker/dependency toolchain

## Evidence

CI использует Node 24 и `npm ci`. `Dockerfile.mobile` использует Node 22 и
`npm install --ignore-scripts --force`. В `package.json` отсутствует `engines`.
Это позволяет CI и production собрать разные dependency trees или обнаружить
несовместимость только в worker/runtime.

В репозитории есть optional Windows embedded PostgreSQL dependency и исторический
workaround для Linux/native build. Поэтому механическая замена install command
опасна.

## Изменение

1. Зафиксировать Node `22.x` как поддерживаемый major: он уже используется
   production Docker base, является LTS-линией и совместим с Next 16, React 19,
   `sharp` и migration/worker runtime. Закрепить его в
   `package.json.engines.node`, CI setup-node, всех Docker stages и
   dev/runtime documentation. Перед commit проверить native packages на чистом
   Node 22 image; переход на другой major — отдельная задача.
2. Перейти в Docker на lockfile-enforcing install (`npm ci` либо документирован-
   ный эквивалент), не используя `--force` без конкретной причины.
3. Если workaround для optional dependency остаётся, изолировать его в
   отдельном явно названном шаге и покрыть smoke validation.
4. Проверить одинаковый toolchain для builder, migration runner, TMC push worker
   и runtime image.
5. Не обновлять зависимости в этой задаче без необходимости: цель —
   reproducibility, а не dependency refresh.

## TDD/validation

- clean checkout + `npm ci` проходит;
- `npm ci` не меняет lockfile;
- Docker builder проходит без network-time surprises после install;
- `npm run build`, `npm run security:check`, worker import и migration smoke
  проходят на выбранном Node;
- CI/Docker config test подтверждает одинаковый major;
- optional embedded PostgreSQL dependency не импортируется в production runtime
  случайно.

## Подводные камни

- Node major должен соответствовать Next 16 и native `sharp`/embedded Postgres.
- Не копировать `.env*`, secrets или `.git` в image.
- Не менять `npm` lockfile вручную.
- Не ломать Windows developer path с кириллическим каталогом.

## Acceptance

CI и Docker используют один объявленный Node major; clean image build
воспроизводим по lockfile; builder/worker/migrator/runtime smoke зелёные.
