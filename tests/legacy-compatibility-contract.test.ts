import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("legacy compatibility policy is discoverable and part of the CI contract", async () => {
  const [documentation, workflow, packageJson] = await Promise.all([
    readFileAsync("docs/legacy-compatibility.md", "utf8"),
    readFileAsync(".github/workflows/tests.yml", "utf8"),
    readFileAsync("package.json", "utf8"),
  ]);

  for (const entry of [
    "LEGACY-PERMISSIONS",
    "LEGACY-TRANSFER-ROUTES",
    "LEGACY-QR-ALIASES",
    "LEGACY-AUTH-IMPORT",
    "LEGACY-COOKIE-CONTRACT",
    "LEGACY-SEED-DATA",
  ]) {
    assert.match(documentation, new RegExp(`^### ${entry}$`, "m"));
  }
  assert.match(documentation, /90 (?:days|дней)/);
  assert.match(documentation, /evidence_status=unknown/);
  assert.match(workflow, /npm run legacy:check/);
  assert.match(packageJson, /"legacy:check"\s*:/);
});

test("legacy compatibility checker rejects new registry values and runtime imports", () => {
  const cases = [
    {
      name: "unknown permission",
      relativeFile: "lib/security/permissions.ts",
      addition: '\nexport const undocumentedPermission = "legacy.new.read";\n',
      expected: /not in scripts\/legacy-compatibility-baseline\.json/,
    },
    {
      name: "undocumented baseline addition",
      relativeFile: "scripts/legacy-compatibility-baseline.json",
      mutate: (source: string) => {
        const baseline = JSON.parse(source);
        baseline.legacyPermissions.push("legacy.new.read");
        baseline.documentedValues["LEGACY-PERMISSIONS"].push("legacy.new.read");
        return JSON.stringify(baseline, null, 2);
      },
      expected: /does not document legacy\.new\.read/,
    },
    {
      name: "unknown QR format",
      relativeFile: "lib/contracts/inventory-domain.ts",
      addition: '\nexport const undocumentedQrFormat = "legacy_v2";\n',
      expected: /QR format legacy_v2/,
    },
    {
      name: "runtime seed import",
      relativeFile: "lib/runtime/unsafe.ts",
      addition: 'void import("@/lib/data");\n',
      expected: /seed-only compatibility source/,
    },
    {
      name: "side-effect seed import",
      relativeFile: "proxy.ts",
      addition: 'import "@/lib/data";\n',
      expected: /seed-only compatibility source/,
    },
    {
      name: "runtime credential access",
      relativeFile: "lib/runtime/unsafe-auth.ts",
      addition: "void process.env.AUTH_ADMIN_EMAIL;\n",
      expected: /direct legacy credential file\/environment access/,
    },
    {
      name: "undocumented cookie claim",
      relativeFile: "lib/security/session.ts",
      mutate: (source: string) => source.replace("  ver: number;", "  ver: number;\n  legacyExtra: string;"),
      expected: /SessionPayload fields must match/,
    },
    {
      name: "overdue review",
      relativeFile: "scripts/legacy-compatibility-baseline.json",
      mutate: (source: string) =>
        JSON.stringify({ ...JSON.parse(source), nextReview: "2020-01-01" }, null, 2),
      expected: /nextReview .* overdue/,
    },
  ];

  for (const entry of cases) {
    const fixtureRoot = createCheckerFixture();
    try {
      const target = path.join(fixtureRoot, entry.relativeFile);
      mkdirSync(path.dirname(target), { recursive: true });
      const original = existsSync(target) ? readFileSync(target, "utf8") : "";
      writeFileSync(target, entry.mutate ? entry.mutate(original) : original + entry.addition, "utf8");
      const result = runChecker(fixtureRoot);
      assert.notEqual(result.status, 0, `${entry.name} must be rejected`);
      assert.match(`${result.stdout}\n${result.stderr}`, entry.expected, entry.name);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

const CHECKER_FIXTURE_FILES = [
  "docs/legacy-compatibility.md",
  "scripts/legacy-compatibility-baseline.json",
  "lib/contracts/inventory-domain.ts",
  "lib/data.ts",
  "lib/domain/qr-identifier.ts",
  "lib/security/permissions.ts",
  "lib/security/session.ts",
  "scripts/db/seed.ts",
  "app/api/inventory/transfers/route.ts",
  "app/api/inventory/transfers/[id]/cancel/route.ts",
  "app/api/inventory/transfers/[id]/decision/route.ts",
  "app/api/inventory/transfers/[id]/override/route.ts",
];

function createCheckerFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "yu-legacy-check-"));
  for (const relativeFile of CHECKER_FIXTURE_FILES) {
    const source = path.join(process.cwd(), relativeFile);
    const target = path.join(fixtureRoot, relativeFile);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
  }
  return fixtureRoot;
}

function runChecker(fixtureRoot) {
  return spawnSync(
    process.execPath,
    ["scripts/check-legacy-compatibility.mjs", "--root", fixtureRoot],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}
