import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const componentsRoot = path.join(root, "components");
const storiesRoot = path.join(root, "stories");
const appRoot = path.join(root, "app");
const errors = [];

async function filesBelow(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

function sourceFile(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function hasExport(node) {
  return Boolean(node.modifiers?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
}

function propertyName(member) {
  if (!member.name) return null;
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return member.name.text;
  return null;
}

function inspectPropMembers(file, members, owner) {
  const forbiddenStyleProps = new Set(["className", "style"]);
  const forbiddenVisualSlots = new Set(["fallback", "headerActions", "renderActions"]);
  const forbiddenCosmeticProps = new Set(["color", "background", "border", "borderRadius", "shadow"]);
  for (const member of members) {
    if (!ts.isPropertySignature(member) && !ts.isPropertyDeclaration(member)) continue;
    const name = propertyName(member);
    if (!name) continue;
    if (forbiddenStyleProps.has(name)) {
      errors.push(`${file}: ${owner} exposes forbidden visual override prop "${name}".`);
    }
    if (forbiddenVisualSlots.has(name)) {
      errors.push(`${file}: ${owner} exposes visual slot "${name}" instead of a semantic contract.`);
    }
    if (path.basename(file) !== "Wrapper.tsx" && forbiddenCosmeticProps.has(name)) {
      errors.push(`${file}: ${owner} exposes cosmetic prop "${name}".`);
    }
  }
}

const componentFiles = await filesBelow(componentsRoot, (file) => file.endsWith(".tsx"));
for (const file of componentFiles) {
  if (path.dirname(file) !== componentsRoot) {
    errors.push(`${file}: component files must be flat under components/.`);
  }
  const source = await readFile(file, "utf8");
  const ast = sourceFile(file, source);
  const declaredProps = new Map();

  for (const statement of ast.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      declaredProps.set(statement.name.text, statement.members);
      if (hasExport(statement) || statement.name.text.endsWith("Props")) {
        inspectPropMembers(file, statement.members, statement.name.text);
      }
    }
    if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      declaredProps.set(statement.name.text, statement.type.members);
      if (hasExport(statement) || statement.name.text.endsWith("Props")) {
        inspectPropMembers(file, statement.type.members, statement.name.text);
      }
    }
  }

  function inspectComponent(node, name, exported) {
    if (!/^[A-Z]/.test(name)) return;
    if (!exported) errors.push(`${file}: local component ${name} must be extracted/exported from components/.`);
    const parameter = node.parameters?.[0];
    const type = parameter?.type;
    if (type && ts.isTypeLiteralNode(type)) inspectPropMembers(file, type.members, `${name} props`);
    if (type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const members = declaredProps.get(type.typeName.text);
      if (members) inspectPropMembers(file, members, `${name} props`);
    }
  }

  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      inspectComponent(statement, statement.name.text, hasExport(statement));
    }
    if (ts.isVariableStatement(statement)) {
      const exported = hasExport(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (!declaration.initializer || (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer))) continue;
        inspectComponent(declaration.initializer, declaration.name.text, exported);
      }
    }
  }
}

const storyFiles = await filesBelow(storiesRoot, (file) => file.endsWith(".stories.tsx"));
const coveredComponentFiles = new Set();
for (const file of storyFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/from\s+["']@\/components\/([^"']+)["']/g)) {
    coveredComponentFiles.add(`${match[1]}.tsx`);
  }
}
for (const file of componentFiles) {
  const relative = path.relative(componentsRoot, file).replaceAll("\\", "/");
  if (!coveredComponentFiles.has(relative)) {
    errors.push(`${file}: missing Storybook story import.`);
  }
}

const routeFiles = await filesBelow(appRoot, (file) => /(?:page|layout)\.tsx$/.test(file));
for (const file of routeFiles) {
  const source = await readFile(file, "utf8");
  const ast = sourceFile(file, source);
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && /^[A-Z]/.test(node.name.text) && !hasExport(node)) {
      errors.push(`${file}: page-local component ${node.name.text} must live in components/.`);
    }
    if (file !== path.join(appRoot, "layout.tsx") && ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "className" || node.name.text === "style") {
        errors.push(`${file}: route files must delegate layout to Wrapper and visuals to components (found ${node.name.text}).`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

if (errors.length > 0) {
  console.error("UI architecture check failed:\n");
  for (const error of errors) console.error(`- ${path.relative(root, error)}`);
  process.exit(1);
}

console.log(`UI architecture check passed: ${componentFiles.length} flat component files, ${storyFiles.length} story files.`);
