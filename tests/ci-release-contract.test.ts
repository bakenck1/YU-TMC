import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { getDatabaseTestFiles } from "../scripts/database-test-files.mjs";

test("CI validates the documented release gates in dependency order", async () => {
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const migrationIndex = workflow.indexOf("npm run db:migrate -- --target=test");
  const smokeIndex = workflow.indexOf("npm run db:smoke -- --target=test");
  const testsIndex = workflow.indexOf("npm run test:all");

  assert.ok(migrationIndex >= 0);
  assert.ok(smokeIndex > migrationIndex);
  assert.ok(testsIndex > smokeIndex);
  assert.match(workflow, /TEST_DATABASE_URL:/);
  assert.match(workflow, /TEST_DATABASE_MIGRATOR_URL:/);
  assert.match(workflow, /yu-inventory-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /npm run docs:check/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run ui:check/);
  assert.match(workflow, /npm run db:check/);
  assert.match(workflow, /npm run storybook:build/);
  assert.match(workflow, /bash -n deploy\/backup-postgres\.sh/);
  assert.match(workflow, /bash -n deploy\/enable-https\.sh/);
  assert.match(workflow, /node --check deploy\/backup-postgres-connection\.mjs/);
  assert.match(workflow, /bash scripts\/test-deployment-runtime\.sh/);
});

test("direct deployment performs migration, settings import, and smoke checks before services start", async () => {
  const deploymentGuide = await readFile("deploy/README.md", "utf8");
  const appService = await readFile("deploy/systemd/yu-inventory.service", "utf8");
  const workerService = await readFile("deploy/systemd/yu-inventory-push-worker.service", "utf8");
  const migrationIndex = deploymentGuide.indexOf("npm run db:migrate -- --target=production");
  const importIndex = deploymentGuide.indexOf("npm run db:import-settings -- --target=production");
  const smokeIndex = deploymentGuide.indexOf("npm run db:smoke -- --target=production");

  assert.ok(migrationIndex >= 0);
  assert.ok(importIndex > migrationIndex);
  assert.ok(smokeIndex > importIndex);
  assert.match(deploymentGuide, /--source=\/secure\/path\/settings\.json/);
  assert.match(
    appService,
    /ExecStart=\/usr\/bin\/npm run start -- --hostname 127\.0\.0\.1 --port 3000/,
  );
  assert.match(workerService, /ExecStart=\/usr\/bin\/npm run worker:tmc-push -- --loop/);
});

test("production deployment protects HTTPS activation and database backups", async () => {
  const guide = await readFile("deploy/README.md", "utf8");
  const httpsScript = await readFile("deploy/enable-https.sh", "utf8");
  const backupScript = await readFile("deploy/backup-postgres.sh", "utf8");
  const backupHelper = await readFile("deploy/backup-postgres-connection.mjs", "utf8");
  const httpConfig = await readFile("deploy/nginx/yu-inventory-http.conf", "utf8");
  const httpsConfig = await readFile("deploy/nginx/yu-inventory.conf", "utf8");
  const backupService = await readFile("deploy/systemd/yu-inventory-backup.service", "utf8");
  const backupTimer = await readFile("deploy/systemd/yu-inventory-backup.timer", "utf8");
  const deploymentSmokeTest = await readFile("scripts/test-deployment-runtime.sh", "utf8");
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");

  assert.match(guide, /yu-inventory-backup\.timer/);
  assert.match(guide, /sites-enabled\/yu-inventory\.conf/);
  assert.match(httpsScript, /openssl x509 -in \"\$certificate\" -checkhost \"\$domain\"/);
  assert.match(httpsScript, /certificate, full chain, and private key do not match/);
  assert.match(httpsScript, /nginx -t/);
  assert.match(httpsScript, /systemctl reload nginx/);
  const activationStart = httpsScript.indexOf(
    'if [[ -e "$installed_certificate_directory/fullchain.pem"',
  );
  const activation = httpsScript.slice(activationStart);
  assert.ok(activation.indexOf("nginx -t") < activation.indexOf("systemctl reload nginx"));
  assert.match(httpsScript, /nginx_enabled_config/);
  assert.match(httpsScript, /nginx -T/);
  assert.match(httpsScript, /Another Nginx configuration owns a default port 80\/443 listener/);
  assert.match(httpsScript, /flock -n 9/);
  assert.match(httpsScript, /source_snapshot_directory/);
  assert.match(httpsScript, /trusted_nginx_config/);
  assert.match(httpsScript, /cat \"\$certificate\" \"\$chain\"/);
  assert.match(httpsScript, /assertOrder\(presentedChain/);
  assert.match(httpsScript, /validated_fullchain/);
  assert.match(httpsScript, /validated-fullchain\.pem/);
  assert.match(httpsScript, /Certificate destination must be a real directory/);
  assert.match(httpsScript, /Private key must use mode 0400 or 0600/);
  assert.match(httpsScript, /restore_previous_state/);
  assert.match(httpsScript, /restored Nginx configuration could not be reloaded/);
  assert.match(backupScript, /Environment file must be a root-owned regular file with mode 0600/);
  assert.match(backupScript, /flock -n 9/);
  assert.match(backupScript, /connection_helper/);
  assert.match(backupScript, /node \"\$connection_helper\"/);
  assert.match(backupScript, /DATABASE_MIGRATOR_URL/);
  assert.match(backupScript, /DATABASE_URL is required/);
  assert.match(backupScript, /DATABASE_DEPLOYMENT_ID is required/);
  assert.doesNotMatch(backupScript, /^source /m);
  assert.match(backupScript, /read -r environment_line/);
  assert.match(backupScript, /psql/);
  assert.match(backupScript, /schema_contract_query/);
  assert.match(backupScript, /migrator_deployment_id/);
  assert.match(backupScript, /runtime_deployment_id/);
  assert.match(backupScript, /env -i/);
  assert.match(backupHelper, /source\.search/);
  assert.match(backupScript, /database_url_without_password/);
  assert.match(backupScript, /PGPASSFILE/);
  assert.match(backupScript, /--no-password/);
  assert.doesNotMatch(backupScript, /--dbname=\"\$DATABASE_MIGRATOR_URL\"/);
  assert.match(backupScript, /PGSSLMODE=\"\$database_ssl_mode\"/);
  assert.match(backupScript, /pg_restore --list/);
  assert.match(backupScript, /-name 'yu-inventory-\*\.dump' -mtime \+30 -delete/);
  assert.match(backupHelper, /same database/);
  assert.match(backupHelper, /runtimeConnectionUrl/);
  assert.match(backupHelper, /connectionUrl/);
  assert.match(backupHelper, /pgpass/);
  assert.match(guide, /backup-postgres-connection\.mjs/);
  assert.match(httpConfig, /listen 80;/);
  assert.match(httpConfig, /return 404/);
  assert.doesNotMatch(httpConfig, /proxy_pass/);
  assert.match(httpsConfig, /listen 80 default_server/);
  assert.match(httpsConfig, /listen 443 ssl default_server/);
  assert.match(httpsConfig, /return 444/);
  assert.doesNotMatch(httpsConfig, /ssl_reject_handshake/);
  assert.match(httpsConfig, /client_max_body_size 11m/);
  assert.match(httpsConfig, /ssl_protocols TLSv1\.2 TLSv1\.3/);
  assert.match(httpsConfig, /return 308 https:\/\/inventory\.yu\.edu\.kz\$request_uri/);
  assert.match(backupService, /ProtectSystem=strict/);
  assert.match(backupService, /Wants=network-online\.target/);
  assert.match(backupService, /After=network-online\.target/);
  assert.doesNotMatch(backupService, /Requires=postgresql\.service/);
  assert.match(backupService, /ReadWritePaths=\/var\/backups\/yu-inventory \/run\/lock/);
  assert.match(backupService, /TimeoutStartSec=30min/);
  assert.match(backupTimer, /Persistent=true/);
  assert.match(workflow, /bash scripts\/test-deployment-runtime\.sh/);
  assert.match(deploymentSmokeTest, /docker run --rm/);
  assert.match(deploymentSmokeTest, /schema deployment mismatch was accepted/);
  assert.match(deploymentSmokeTest, /Nginx reload failure was accepted/);
});

test("external development startup prepares the database before Next.js", async () => {
  const devScript = await readFile("scripts/dev.mjs", "utf8");
  const externalBranch = devScript.slice(devScript.lastIndexOf("if (configuredDatabaseUrl)"));
  const migrationIndex = externalBranch.indexOf('["run", "db:migrate"');
  const importIndex = externalBranch.indexOf('["run", "db:import-settings"');
  const smokeIndex = externalBranch.indexOf('["run", "db:smoke"');
  const nextIndex = externalBranch.indexOf('["run", "dev:next"]');

  assert.ok(migrationIndex >= 0);
  assert.ok(importIndex > migrationIndex);
  assert.ok(smokeIndex > importIndex);
  assert.ok(nextIndex > smokeIndex);
});

test("the database runner discovers every committed database test", () => {
  const expected = readdirSync(path.join(process.cwd(), "tests", "database"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => path.join("tests", "database", name));

  assert.deepEqual(getDatabaseTestFiles(process.cwd()), expected);
  assert.ok(expected.length > 0);
});

test("test runner requires paired database credentials and reports skipped coverage", async () => {
  const runner = await readFile("scripts/test-all.mjs", "utf8");
  assert.match(runner, /TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL must be provided together/);
  assert.match(runner, /required in CI/);
  assert.match(runner, /database=\$\{hasRuntimeDatabase \? "ran" : "SKIPPED"\}/);
});
