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
  assert.match(workflow, /sudo env .*bash scripts\/test-deployment-runtime\.sh/);
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
  assert.match(workflow, /sudo env .*bash scripts\/test-deployment-runtime\.sh/);
  assert.doesNotMatch(deploymentSmokeTest, /docker/);
  assert.match(deploymentSmokeTest, /must run as root/);
  assert.match(deploymentSmokeTest, /schema deployment mismatch was accepted/);
  assert.match(deploymentSmokeTest, /Nginx reload failure was accepted/);
});

test("photo limits stay aligned across the implementation and product artifacts", async () => {
  const validationGuide = await readFile("docs/field-validation.md", "utf8");
  const mobileMockups = await readFile("docs/mobile-mockups.html", "utf8");
  const itemPhotoService = await readFile(
    "lib/application/services/inventory-item-service.ts",
    "utf8",
  );
  const servicePhotoNormalizer = await readFile(
    "lib/server/photos/normalize-uploaded-photo.ts",
    "utf8",
  );
  const serviceRequestService = await readFile(
    "lib/application/services/service-request-service.ts",
    "utf8",
  );
  const serverApplication = await readFile("lib/server/application.ts", "utf8");
  const schema = await readFile("lib/db/schema.ts", "utf8");
  const serviceRequestRepository = await readFile(
    "lib/server/persistence/postgres/postgres-service-request-repositories.ts",
    "utf8",
  );
  const itemRepository = await readFile(
    "lib/server/persistence/postgres/postgres-inventory-item-repositories.ts",
    "utf8",
  );
  const photoLifecycleMigration = await readFile(
    "drizzle/20260826120000_photo_lifecycle_guard.sql",
    "utf8",
  );
  const primaryPhotoSection = validationGuide.slice(
    validationGuide.indexOf("### Основная фотография предмета"),
    validationGuide.indexOf("### Фотография сервисной заявки"),
  );
  const serviceRequestPhotoSection = validationGuide.slice(
    validationGuide.indexOf("### Фотография сервисной заявки"),
    validationGuide.indexOf("### Фотографии проверок и споров"),
  );
  const inspectionPhotoSection = validationGuide.slice(
    validationGuide.indexOf("### Фотографии проверок и споров"),
    validationGuide.indexOf("Для всех потоков сервер"),
  );
  assert.ok(primaryPhotoSection.length > 0);
  assert.ok(serviceRequestPhotoSection.length > 0);
  assert.ok(inspectionPhotoSection.length > 0);
  assert.match(primaryPhotoSection, /только JPEG/);
  assert.match(primaryPhotoSection, /максимум 5 MiB/);
  assert.match(primaryPhotoSection, /2,5 мегапикселя и 1920 px/);
  assert.doesNotMatch(primaryPhotoSection, /10 MiB|8192 px/);
  assert.match(serviceRequestPhotoSection, /JPEG, PNG и WebP/);
  assert.match(serviceRequestPhotoSection, /не более 5 MiB/);
  assert.match(serviceRequestPhotoSection, /20 мегапикселей/);
  assert.match(serviceRequestPhotoSection, /до 1280 px/);
  assert.match(serviceRequestPhotoSection, /service_requests\.photo_binary_data/);
  assert.doesNotMatch(serviceRequestPhotoSection, /10 MiB|8192 px/);
  assert.match(inspectionPhotoSection, /inspection_result/);
  assert.match(inspectionPhotoSection, /decision_dispute/);
  assert.match(inspectionPhotoSection, /1 до 10 MiB/);
  assert.match(inspectionPhotoSection, /8192 px/);
  assert.match(inspectionPhotoSection, /20 мегапикселей/);
  assert.match(inspectionPhotoSection, /originalObjectKey/);
  assert.match(inspectionPhotoSection, /после присоединения обязательно `previewObjectKey`/);
  assert.match(
    inspectionPhotoSection,
    /mobile-mockups\.html.*result\.photoError.*10 МБ.*inspection_result.*сервисной заявки/s,
  );
  assert.match(
    inspectionPhotoSection,
    /upload\/read handlers.*inspection_result.*decision_dispute.*не подключены/,
  );
  assert.match(validationGuide, /inventory\.photo\.item_original/);
  assert.match(validationGuide, /inventory\.photo\.inspection_original/);
  assert.match(validationGuide, /inventory\.photo\.dispute_original/);
  assert.match(validationGuide, /используют предварительное резервирование записей/);
  assert.match(validationGuide, /не используют 30-минутную reservation-фазу/);
  assert.match(mobileMockups, /"result\.photoError": "Фотографию не удалось обработать\. Выберите JPEG, PNG или WebP до 10 МБ\."/);
  assert.match(mobileMockups, /"result\.photoError": "Фотосуретті өңдеу мүмкін болмады\. 10 МБ-қа дейінгі JPEG, PNG немесе WebP таңдаңыз\."/);
  assert.match(mobileMockups, /"result\.photoError": "The photo could not be processed\. Choose a JPEG, PNG, or WebP file up to 10 MB\."/);
  assert.match(mobileMockups, /"lab\.intro": "[^\n]*inspection_result[^\n]*10 МБ[^\n]*сервисная заявка\./);
  assert.match(mobileMockups, /"lab\.intro": "[^\n]*inspection_result[^\n]*10 МБ-қа дейінгі[^\n]*сервис өтінімі емес\./);
  assert.match(mobileMockups, /"lab\.intro": "[^\n]*inspection_result[^\n]*10 MB[^\n]*service-request flow\./);
  assert.match(itemPhotoService, /data:image.*jpeg;base64/);
  assert.match(itemPhotoService, /limitInputPixels: 2_500_000/);
  assert.match(itemPhotoService, /width > 1920/);
  assert.match(itemPhotoService, /height > 1920/);
  assert.match(itemPhotoService, /processed\.data\.byteLength > 5 \* 1024 \* 1024/);
  assert.match(servicePhotoNormalizer, /data:image.*jpeg.*png.*webp/);
  assert.match(servicePhotoNormalizer, /const MAX_PHOTO_BYTES = 5 \* 1024 \* 1024/);
  assert.match(servicePhotoNormalizer, /source\.byteLength > MAX_PHOTO_BYTES/);
  assert.match(servicePhotoNormalizer, /limitInputPixels: 20_000_000/);
  assert.match(servicePhotoNormalizer, /metadata\.pages/);
  assert.match(servicePhotoNormalizer, /width: 1280/);
  assert.match(servicePhotoNormalizer, /height: 1280/);
  assert.match(servicePhotoNormalizer, /normalized\.data\.byteLength > MAX_PHOTO_BYTES/);
  assert.match(serviceRequestService, /this\.photos\.normalize\(input\.photo\?\.imageDataUrl\)/);
  assert.match(serverApplication, /normalize: normalizeUploadedPhoto/);
  assert.match(schema, /photoBinaryData: binaryData\("photo_binary_data"\)/);
  assert.match(schema, /dataType: \(\) => "bytea"/);
  assert.match(schema, /service_requests_photo_check/);
  assert.match(schema, /photoByteSize} BETWEEN 1 AND 5242880/);
  assert.match(schema, /photoWidth} BETWEEN 1 AND 1920/);
  assert.match(schema, /photoHeight} BETWEEN 1 AND 1920/);
  assert.match(schema, /photoWidth}::bigint \* .*photoHeight}::bigint <= 2500000/);
  assert.match(schema, /photos_size_check/);
  assert.match(schema, /BETWEEN 1 AND 10485760/);
  assert.match(schema, /photos_dimensions_check/);
  assert.match(schema, /BETWEEN 1 AND 8192/);
  assert.match(schema, /<= 20000000/);
  assert.match(schema, /photos_parent_check/);
  assert.match(schema, /photos_attached_metadata_check/);
  assert.match(schema, /photos_lifecycle_check/);
  assert.match(photoLifecycleMigration, /photos_lifecycle_transition/);
  assert.match(photoLifecycleMigration, /photos_lifecycle_transition_guard/);
  assert.match(photoLifecycleMigration, /DROP TRIGGER IF EXISTS/);
  assert.match(photoLifecycleMigration, /OLD\.status = 'reserved'/);
  assert.match(photoLifecycleMigration, /OLD\.status = 'attached'/);
  assert.match(photoLifecycleMigration, /NEW\.status = 'purged'/);
  assert.match(serviceRequestRepository, /photo_binary_data/);
  assert.match(serviceRequestRepository, /input\.photoBytes/);
  assert.match(serviceRequestRepository, /new Uint8Array\(row\.photo_binary_data\)/);
  assert.match(itemRepository, /insertServiceItemPhoto/);
  assert.match(itemRepository, /purpose = 'service_request'/);
  assert.match(itemRepository, /Buffer\.from\(input\.bytes\)/);
  assert.match(itemRepository, /findServiceItemPhoto/);
  assert.match(itemRepository, /row\?\.binary_data/);
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
