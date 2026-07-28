import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

export type SourceModules = Readonly<Record<string, string>>;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((moduleName) => {
    const bareName = moduleName.replace(/^node:/, "");
    return [bareName, `node:${bareName}`];
  }),
);

export function validateServerBoundaries(modules: SourceModules): string[] {
  const normalizedModules = new Map(
    Object.entries(modules).map(([filename, source]) => [
      normalizeFilename(filename),
      source,
    ]),
  );
  const findings: string[] = [];

  for (const [filename, source] of normalizedModules) {
    const imports = collectImports(filename, source);

    if (
      filename.startsWith("lib/server/") &&
      !imports.includes("server-only")
    ) {
      findings.push(`${filename}: server module must import "server-only".`);
    }
  }

  for (const filename of normalizedModules.keys()) {
    if (isUiEntrypoint(filename)) {
      validateUiPersistenceGraph(filename, normalizedModules, findings);
    }
    if (isPureApplicationModule(filename)) {
      validatePureApplicationGraph(filename, normalizedModules, findings);
    }
  }

  for (const [filename, source] of normalizedModules) {
    if (!hasUseClientDirective(filename, source)) continue;
    validateClientGraph(filename, normalizedModules, findings);
  }

  return [...new Set(findings)].sort();
}

function validateUiPersistenceGraph(
  entrypoint: string,
  modules: Map<string, string>,
  findings: string[],
) {
  walkLocalGraph(entrypoint, modules, ({ filename, resolved, specifier }) => {
    if (isDatabasePackage(specifier) || isPersistencePath(resolved)) {
      findings.push(
        `${entrypoint}: UI/HTTP import graph reaches persistence module "${specifier}" through ${filename}.`,
      );
      return "stop";
    }

    if (resolved === "lib/server/application.ts") return "stop";
    return "continue";
  });
}

function validatePureApplicationGraph(
  entrypoint: string,
  modules: Map<string, string>,
  findings: string[],
) {
  walkLocalGraph(entrypoint, modules, ({ filename, resolved, specifier }) => {
    if (
      isInfrastructurePackage(specifier) ||
      isServerOrDatabasePath(resolved)
    ) {
      findings.push(
        `${entrypoint}: domain/application import graph reaches infrastructure module "${specifier}" through ${filename}.`,
      );
      return "stop";
    }
    return "continue";
  });
}

interface GraphEdge {
  readonly filename: string;
  readonly resolved: string | undefined;
  readonly specifier: string;
}

function walkLocalGraph(
  entrypoint: string,
  modules: Map<string, string>,
  inspect: (edge: GraphEdge) => "continue" | "stop",
) {
  const queue = [entrypoint];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const filename = queue.shift()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    const source = modules.get(filename);
    if (source === undefined) continue;

    for (const specifier of collectImports(filename, source)) {
      const resolved = resolveImport(filename, specifier, modules);
      if (inspect({ filename, resolved, specifier }) === "stop") continue;
      if (resolved) queue.push(resolved);
    }
  }
}

function validateClientGraph(
  entrypoint: string,
  modules: Map<string, string>,
  findings: string[],
) {
  const queue = [entrypoint];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const filename = queue.shift()!;
    if (visited.has(filename)) continue;
    visited.add(filename);
    const source = modules.get(filename);
    if (source === undefined) continue;

    for (const specifier of collectImports(filename, source)) {
      if (isClientServerPackage(specifier)) {
        findings.push(
          `${entrypoint}: client import graph reaches server dependency "${specifier}" through ${filename}.`,
        );
        continue;
      }

      const resolved = resolveImport(filename, specifier, modules);
      if (!resolved) continue;
      if (isServerOrDatabasePath(resolved)) {
        findings.push(
          `${entrypoint}: client import graph reaches ${resolved} through ${filename}.`,
        );
        continue;
      }
      queue.push(resolved);
    }
  }
}

function collectImports(filename: string, source: string) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ((node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function hasUseClientDirective(filename: string, source: string) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
}

function resolveImport(
  importer: string,
  specifier: string,
  modules: Map<string, string>,
) {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = normalizeFilename(specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = normalizeFilename(path.posix.join(path.posix.dirname(importer), specifier));
  } else {
    return undefined;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => modules.has(candidate));
}

function isUiEntrypoint(filename: string) {
  return filename.startsWith("app/") || filename.startsWith("components/");
}

function isPureApplicationModule(filename: string) {
  return (
    filename.startsWith("lib/application/") ||
    filename.startsWith("lib/contracts/") ||
    filename.startsWith("lib/domain/")
  );
}

function isInfrastructurePackage(specifier: string) {
  return (
    NODE_BUILTINS.has(specifier) ||
    isDatabasePackage(specifier) ||
    specifier === "next" ||
    specifier.startsWith("next/") ||
    specifier === "react" ||
    specifier.startsWith("react/")
  );
}

function isDatabasePackage(specifier: string) {
  return (
    specifier === "pg" ||
    specifier.startsWith("pg/") ||
    specifier === "drizzle-orm" ||
    specifier.startsWith("drizzle-orm/")
  );
}

function isClientServerPackage(specifier: string) {
  return (
    specifier === "server-only" ||
    NODE_BUILTINS.has(specifier) ||
    isDatabasePackage(specifier)
  );
}

function isPersistencePath(filename: string | undefined) {
  return (
    filename?.startsWith("lib/db/") === true ||
    filename?.startsWith("lib/server/persistence/") === true
  );
}

function isServerOrDatabasePath(filename: string | undefined) {
  return (
    filename?.startsWith("lib/server/") === true ||
    filename?.startsWith("lib/db/") === true
  );
}

function normalizeFilename(filename: string) {
  return filename.replaceAll("\\", "/").replace(/^\.?\//, "");
}
