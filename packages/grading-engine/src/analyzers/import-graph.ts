/**
 * import-graph.ts — deterministic, dependency-free import graph builder.
 *
 * Why this exists
 * ---------------
 * Several analyzers need resolved import *edges* (not just import counts):
 * strongly-connected-component cycle detection, layering rules, and
 * afferent/efferent coupling all require knowing which concrete file an import
 * points at.
 *
 * The existing `@reporank/static-analysis` AST parser is a filesystem CLI and
 * only counts imports; the other analyzers use ad-hoc regexes that never
 * resolve targets. This module resolves in-memory `sourceFiles` (the shape every
 * grading-engine analyzer already receives) to a real graph, so the structural
 * analyzers can reuse one honest source of truth.
 *
 * No LLM, no network, no new runtime dependencies. Every edge is derived from
 * the file content and a deterministic path-resolution order, so the same input
 * always yields the same graph.
 */

export interface GraphSourceFile {
  path: string;
  content: string;
}

export interface ModuleGraph {
  /** All internal module nodes, normalized to forward-slash paths, sorted. */
  nodes: string[];
  /** Internal edges only: from -> sorted unique resolved module targets. */
  edges: Map<string, string[]>;
  /** External (unresolved bare) specifiers per file, for coupling counts. */
  external: Map<string, string[]>;
  /** from -> target -> 1-based import line, for located findings. */
  lines: Map<string, Map<string, number>>;
}

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const JS_CODE_EXTS = new Set(JS_EXTS);
const PY_CODE_EXTS = new Set([".py"]);

/** Normalize a path to forward slashes and drop any leading "./". */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Directory portion of a normalized path ("" when the file is at the root). */
export function dirName(path: string): string {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}

function extOf(path: string): string {
  const norm = normalizePath(path);
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

export type GraphLanguage = "js" | "py" | "other";

export function languageOf(path: string): GraphLanguage {
  const ext = extOf(path);
  if (JS_CODE_EXTS.has(ext)) return "js";
  if (PY_CODE_EXTS.has(ext)) return "py";
  return "other";
}

interface Specifier {
  raw: string;
  line: number;
}

/**
 * Extract raw import specifiers with their 1-based source line.
 *
 * JavaScript/TypeScript: static imports, side-effect imports, re-exports,
 * `require(...)`, and dynamic `import(...)`.
 * Python: `import a.b` and `from .a import b` (dots preserved).
 */
export function extractImportSpecifiers(content: string, language: GraphLanguage): Specifier[] {
  const specs: Specifier[] = [];
  const lines = content.split(/\r?\n/);

  const patterns: RegExp[] =
    language === "py"
      ? [
          /^\s*from\s+([.\w]+)\s+import\b/,
          /^\s*import\s+([.\w]+)/,
        ]
      : [
          /^\s*import\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/,
          /^\s*import\s*["']([^"']+)["']/,
          /^\s*export\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/,
          /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
          /\bimport\s*\(\s*["']([^"']+)["']\s*\)/,
        ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      for (const m of line.matchAll(re)) {
        const raw = m[1];
        if (raw) specs.push({ raw, line: i + 1 });
      }
    }
  }

  // Deterministic order: by line, then raw specifier.
  specs.sort((a, b) => a.line - b.line || a.raw.localeCompare(b.raw));
  return specs;
}

/** Join a base directory with a relative specifier, resolving "." and "..". */
export function resolveRelativePath(baseDir: string, spec: string): string {
  const parts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const segment of spec.replace(/\\/g, "/").split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function firstExisting(candidates: string[], nodes: Set<string>): string | null {
  for (const candidate of candidates) {
    if (nodes.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve one specifier to an internal module path, or null for external
 * packages (which never participate in cycles or layering rules).
 */
export function resolveSpecifier(
  fromPath: string,
  spec: string,
  language: GraphLanguage,
  nodes: Set<string>,
): string | null {
  if (language === "py") {
    const leadingDots = (spec.match(/^\.+/) || [""])[0].length;
    if (leadingDots > 0) {
      let base = dirName(fromPath);
      // One dot = current package; each extra dot climbs one package.
      for (let i = 1; i < leadingDots; i++) base = dirName(base);
      const rest = spec.slice(leadingDots).replace(/\./g, "/");
      const joined = resolveRelativePath(base, rest);
      return firstExisting(
        [`${joined}.py`, `${joined}/__init__.py`, joined],
        nodes,
      );
    }
    const asPath = spec.replace(/\./g, "/");
    return firstExisting(
      [`${asPath}.py`, `${asPath}/__init__.py`, asPath],
      nodes,
    );
  }

  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const baseDir = dirName(fromPath);
  const target = spec.startsWith("/") ? normalizePath(spec).slice(1) : resolveRelativePath(baseDir, spec);
  const candidates = [target, ...JS_EXTS.map((e) => target + e)];
  for (const ext of JS_EXTS) candidates.push(`${target}/index${ext}`);
  return firstExisting(candidates, nodes);
}

/**
 * Build a resolved module graph from in-memory source files. Only internal
 * edges are stored in `edges`; bare packages land in `external`.
 */
export function buildModuleGraph(sourceFiles: GraphSourceFile[]): ModuleGraph {
  const nodes = new Set<string>();
  for (const file of sourceFiles) nodes.add(normalizePath(file.path));

  const edges = new Map<string, string[]>();
  const external = new Map<string, string[]>();
  const lines = new Map<string, Map<string, number>>();

  const ordered = [...sourceFiles].sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)));

  for (const file of ordered) {
    const from = normalizePath(file.path);
    const language = languageOf(from);
    const targets = new Set<string>();
    const externals = new Set<string>();
    const lineMap = new Map<string, number>();

    for (const { raw, line } of extractImportSpecifiers(file.content, language)) {
      const resolved = resolveSpecifier(from, raw, language, nodes);
      if (resolved) {
        targets.add(resolved);
        if (!lineMap.has(resolved)) lineMap.set(resolved, line);
      } else {
        externals.add(raw);
      }
    }

    edges.set(from, [...targets].sort());
    external.set(from, [...externals].sort());
    lines.set(from, lineMap);
  }

  return { nodes: [...nodes].sort(), edges, external, lines };
}
