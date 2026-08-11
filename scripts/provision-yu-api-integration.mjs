import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const composeFile = path.join(root, "project", "docker-compose.yml");
const environmentFile = path.join(root, ".env.local");
const baseUrl = readArgument("--base-url") ?? "http://127.0.0.1";
const tokenMarker = "__YU_TMC_TOKEN__=";

if (!existsSync(composeFile)) {
  fail("project/docker-compose.yml was not found.");
}

const python = [
  "from django.contrib.auth import get_user_model",
  "from django.contrib.auth.models import Permission",
  "from users.models import APIToken",
  "User = get_user_model()",
  "user, _ = User.objects.get_or_create(username='yu_tmc_service', defaults={'email': 'yu-tmc-service@localhost'})",
  "user.email = 'yu-tmc-service@localhost'",
  "user.is_active = True",
  "user.is_staff = False",
  "user.is_superuser = False",
  "user.set_unusable_password()",
  "user.save()",
  "user.groups.clear()",
  "user.user_permissions.clear()",
  "permission = Permission.objects.get(content_type__app_label='core', codename='view_personnel')",
  "user.user_permissions.add(permission)",
  "token = APIToken.objects.filter(user=user, purpose='YU-TMC personnel directory').order_by('id').first()",
  "token = token or APIToken.objects.create(user=user, purpose='YU-TMC personnel directory')",
  `print('${tokenMarker}' + token.token)`,
].join("; ");

const result = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "app",
    "python",
    "manage.py",
    "shell",
    "-c",
    python,
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
);

if (result.error) fail(`Could not run Docker: ${result.error.message}`);
if (result.status !== 0) {
  const diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split(/\r?\n/)
    .filter((line) => line && !line.includes(tokenMarker))
    .slice(-12)
    .join("\n");
  fail(`YU API token provisioning failed.\n${diagnostic}`);
}

const markerLine = `${result.stdout ?? ""}`
  .split(/\r?\n/)
  .find((line) => line.startsWith(tokenMarker));
const token = markerLine?.slice(tokenMarker.length).trim();
if (!token || !/^[a-f0-9]{32}$/i.test(token)) {
  fail("YU API returned an invalid service token.");
}

let environment = existsSync(environmentFile)
  ? readFileSync(environmentFile, "utf8")
  : "";
environment = setEnvironmentValue(environment, "YU_API_BASE_URL", baseUrl);
environment = setEnvironmentValue(
  environment,
  "YU_API_DOCKER_BASE_URL",
  "http://host.docker.internal",
);
environment = setEnvironmentValue(environment, "YU_API_TOKEN", token);
environment = setEnvironmentValue(environment, "YU_API_TIMEOUT_MS", "5000");
writeFileSync(environmentFile, environment, { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(environmentFile, 0o600);
} catch {
  // Windows ACLs are managed by the current user profile.
}

console.log("YU API integration configured in .env.local.");
console.log("Service account: yu_tmc_service");
console.log("Granted permission: core.view_personnel");
console.log(`Base URL: ${baseUrl}`);

function setEnvironmentValue(source, key, value) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  const separator = source.length === 0 || source.endsWith("\n") ? "" : newline;
  return `${source}${separator}${line}${newline}`;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value) fail(`${name} requires a value.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    fail(`${name} must be an HTTP(S) URL.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
