import { readFileSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

export interface AstFileMetric {
  file: string;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  loc: number;
  maxComplexity: number;
  avgComplexity: number;
}

export interface NodeAstReport {
  parsed: true;
  language: "node";
  files: number;
  metrics: { complexity: number; functions: number; classes: number; files: number };
  perFile: AstFileMetric[];
  /** True when the file cap was hit before the tree was exhausted. */
  truncated: boolean;
}

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".vercel",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  "target",
]);

const FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

const DECISION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function collectFiles(dir: string, maxFiles = 500, maxDepth = 8): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const walk = (current: string, depth: number): void => {
    if (truncated || depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (
        entry.isFile() &&
        CODE_EXT.has(extname(entry.name)) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".min.js")
      ) {
        files.push(full);
      }
    }
  };
  walk(dir, 0);
  return { files, truncated };
}

/** Cyclomatic complexity of one function node (nested functions excluded). */
function complexityOf(node: ts.Node): number {
  let complexity = 1;
  const visit = (child: ts.Node): void => {
    if (child !== node && FUNCTION_KINDS.has(child.kind)) return; // separate function
    if (DECISION_KINDS.has(child.kind)) {
      complexity += 1;
    } else if (ts.isBinaryExpression(child) && LOGICAL_OPERATORS.has(child.operatorToken.kind)) {
      complexity += 1;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return complexity;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

export function analyzeSource(file: string, source: string): AstFileMetric {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let functions = 0;
  let classes = 0;
  let imports = 0;
  let exports = 0;
  const complexities: number[] = [];

  const visit = (node: ts.Node): void => {
    if (FUNCTION_KINDS.has(node.kind)) {
      functions += 1;
      complexities.push(complexityOf(node));
    }
    if (node.kind === ts.SyntaxKind.ClassDeclaration) classes += 1;
    if (ts.isImportDeclaration(node)) imports += 1;
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node) || hasExportModifier(node)) {
      exports += 1;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  const maxComplexity = complexities.length ? Math.max(...complexities) : 0;
  const avgComplexity = complexities.length
    ? complexities.reduce((a, b) => a + b, 0) / complexities.length
    : 0;

  return {
    file,
    functions,
    classes,
    imports,
    exports,
    loc: source ? source.split(/\r?\n/).length : 0,
    maxComplexity,
    avgComplexity: Math.round(avgComplexity * 100) / 100,
  };
}

/**
 * Real AST-based metrics for TS/JS via the TypeScript compiler API. Replaces
 * the previous stub that returned a hardcoded `complexity: 10` without reading
 * a single file.
 */
export async function parseNodeAst(dir: string): Promise<NodeAstReport> {
  const { files, truncated } = collectFiles(dir);
  const perFile: AstFileMetric[] = [];

  for (const file of files) {
    try {
      const source = readFileSync(file, "utf-8");
      perFile.push(analyzeSource(file, source));
    } catch {
      /* unreadable file — skipped, never invented */
    }
  }

  const totalFunctions = perFile.reduce((n, f) => n + f.functions, 0);
  const totalClasses = perFile.reduce((n, f) => n + f.classes, 0);
  const avgMax = perFile.length
    ? perFile.reduce((n, f) => n + f.maxComplexity, 0) / perFile.length
    : 0;

  return {
    parsed: true,
    language: "node",
    files: perFile.length,
    metrics: {
      complexity: Math.round(avgMax),
      functions: totalFunctions,
      classes: totalClasses,
      files: perFile.length,
    },
    perFile,
    truncated,
  };
}
