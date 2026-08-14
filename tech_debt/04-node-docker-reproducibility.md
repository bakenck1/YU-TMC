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

## Status: Done

Node 22 is now declared in `package.json`, `.nvmrc`, CI and Docker; `.npmrc`
rejects other Node majors during dependency installation. Docker uses the
committed lockfile with `npm ci`, keeps platform-specific native optional
packages, and CI builds all image targets with native/import/runtime smoke.

Validation: `npm.cmd ci --dry-run --engine-strict=false --ignore-scripts`,
toolchain contract tests (3/3), `npm.cmd run lint`, `npm.cmd run docs:check`,
native module imports, production build, security check and full `npm.cmd run
test:all` pass. The real Docker build cannot run in this workstation because the
Docker daemon is unavailable; the CI workflow now performs it on every gate run.

Independent review scores: first pass 8/10 (test quality 5/10), second pass
7/10 (test quality 5/10). The second-pass findings about `.npmrc` propagation
and native/runtime smoke were addressed in the final corrective pass. Exact base
image digest pinning remains intentionally outside this minimal major/toolchain
alignment and is a separate release-infrastructure follow-up.
