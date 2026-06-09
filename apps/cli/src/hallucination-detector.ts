// Hallucination detector — Phase 1.2
//
// Scans source files for "phantom" imports: references to packages that
// don't exist in the project's dependency manifests (package.json,
// requirements.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile).
//
// When an LLM generates code, it frequently hallucinates imports for
// libraries that don't exist or are out of date. Catching these before
// they reach CI saves developer time and prevents broken builds.
//
// Per AGENTS.md:
//  - No eval(), no dynamic execution
//  - Files under 300 lines
//  - Deterministic regex-based scan (no LLM needed)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname, basename, extname } from "node:path";

export type HallucinationSeverity = "critical" | "high" | "medium" | "low";

export interface Hallucination {
  /** The file where the phantom import was found */
  file: string;
  /** 1-based line number of the import statement */
  line: number;
  /** The exact import string that was flagged */
  importStatement: string;
  /** The package/module name that doesn't resolve */
  phantomName: string;
  /** The likely cause: "missing-dependency", "deprecated-api", "typo" */
  category: "missing-dependency" | "deprecated-api" | "typo" | "internal-not-found";
  /** Severity based on the impact if merged */
  severity: HallucinationSeverity;
  /** A concrete fix recommendation */
  recommendation: string;
}

export interface HallucinationReport {
  /** Root directory that was scanned */
  root: string;
  /** Number of files scanned */
  filesScanned: number;
  /** Phantom imports found */
  hallucinations: Hallucination[];
  /** Counts by category */
  byCategory: Record<string, number>;
  /** Counts by severity */
  bySeverity: Record<string, number>;
}

/**
 * Known phantom packages — packages that LLMs commonly hallucinate
 * (deprecated APIs, renamed packages, never-existed packages).
 * Catching these is high-confidence; no need to check the manifest.
 */
const KNOWN_PHANTOM_PACKAGES = new Set([
  // Common Python hallucinations
  "python-binance",  // superseded by binance-python / python-binance-connector
  "discord.py",     // real package is just "discord"
  "beautifulsoup",  // real is "bs4"
  "sklearn",        // real is "scikit-learn"
  "PIL",            // real is "Pillow" (PIL is the import name, but the pip package is Pillow)
  "cv2",            // real is "opencv-python"
  // Common JS/TS hallucinations
  "axios-fetch",
  "react-native-vector-icons",  // sometimes hallucinated as a core package
  // Common Go hallucinations
  "github.com/golang/dep",  // deprecated, use go.mod
]);

/**
 * Built-in module names — these are provided by the runtime and don't
 * need to be in the dependency manifest.
 */
const BUILTIN_MODULES: Record<string, string[]> = {
  ts: [
    // Both `node:fs` and bare `fs` forms — LLMs hallucinate either
    "node:fs", "fs", "node:path", "path", "node:os", "os",
    "node:http", "http", "node:https", "https", "node:url", "url",
    "node:querystring", "querystring", "node:crypto", "crypto",
    "node:zlib", "zlib", "node:stream", "stream", "node:buffer", "buffer",
    "node:child_process", "child_process", "node:cluster", "cluster",
    "node:net", "net", "node:tls", "tls", "node:fs/promises", "fs/promises",
    "node:util", "util", "node:events", "events", "node:assert", "assert",
    "node:async_hooks", "async_hooks", "node:perf_hooks", "perf_hooks",
    "node:worker_threads", "worker_threads", "node:diagnostics_channel",
    "diagnostics_channel",
  ],
  py: [
    "os", "sys", "io", "re", "math", "json", "datetime", "time", "random",
    "collections", "functools", "itertools", "pathlib", "typing", "abc",
    "asyncio", "contextlib", "functools", "logging", "unittest", "pytest",
    "io", "string", "textwrap", "struct", "enum", "dataclasses",
  ],
  go: [
    "fmt", "errors", "io", "os", "strings", "strconv", "time", "context",
    "sync", "testing", "net/http", "encoding/json", "encoding/xml",
    "crypto/sha256", "path/filepath", "sort", "math", "regexp",
  ],
  rs: ["std", "core", "alloc", "collections", "vec"],
};

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "target", "vendor", ".aether_prime_cache", "__pycache__", ".venv", "venv"]);

/**
 * Scan the given root directory for phantom imports.
 * Returns a structured report of all hallucinations found.
 */
export async function detectHallucinations(
  root: string,
  options: { files?: string[] } = {},
): Promise<HallucinationReport> {
  const absRoot = resolve(root);
  if (!existsSync(absRoot)) {
    throw new Error(`Path not found: ${absRoot}`);
  }

  // Build the dependency set from all manifests.  When verify is run on a
  // subdirectory (e.g. `apps/cli/src`), we still want to see dependencies
  // declared in `apps/cli/package.json` and the workspace root's
  // `package.json`, so walk up the parent tree to find manifests.
  const depSet = buildDependencySet(absRoot);
  for (let dir = dirname(absRoot); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      parseManifest(join(dir, "package.json"), depSet);
    }
  }

  // Determine which files to scan
  let filesToScan: string[];
  if (options.files && options.files.length > 0) {
    filesToScan = options.files;
  } else {
    const stat = statSync(absRoot);
    if (stat.isFile()) {
      filesToScan = [absRoot];
    } else {
      filesToScan = collectSourceFiles(absRoot);
    }
  }

  // Scan each file
  const hallucinations: Hallucination[] = [];
  for (const file of filesToScan) {
    const fileHallucinations = scanFile(file, absRoot, depSet);
    hallucinations.push(...fileHallucinations);
  }

  // Aggregate
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const h of hallucinations) {
    byCategory[h.category] = (byCategory[h.category] ?? 0) + 1;
    bySeverity[h.severity] = (bySeverity[h.severity] ?? 0) + 1;
  }

  return {
    root: absRoot,
    filesScanned: filesToScan.length,
    hallucinations,
    byCategory,
    bySeverity,
  };
}

/**
 * Build the set of all known dependency names by walking manifest files
 * (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml).
 * Walks both downward (subdirs) and upward (parent manifests) so that
 * verify-on-a-subdir still sees the parent project.
 */
function buildDependencySet(root: string): Set<string> {
  const deps = new Set<string>();

  function walk(d: string): void {
    let entries: string[];
    try { entries = readdirSync(d) as string[]; } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) {
        parseManifest(full, deps);
      }
    }
  }
  walk(root);

  // Also walk up to find parent manifests (e.g. workspace root)
  for (let dir = dirname(root); dir !== dirname(dir); dir = dirname(dir)) {
    for (const manifest of ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"]) {
      const p = join(dir, manifest);
      if (existsSync(p)) parseManifest(p, deps);
    }
  }

  return deps;
}

function parseManifest(file: string, deps: Set<string>): void {
  const name = basename(file);
  try {
    const content = readFileSync(file, "utf-8");
    if (name === "package.json") {
      const json = JSON.parse(content);
      const all = { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies, ...json.optionalDependencies };
      for (const k of Object.keys(all ?? {})) {
        deps.add(k);
        // Also add the unscoped name (e.g. "@scope/name" → "name")
        if (k.startsWith("@") && k.includes("/")) {
          deps.add(k.split("/")[1]);
        }
      }
      // Also add workspaces
      if (Array.isArray(json.workspaces)) {
        for (const ws of json.workspaces) {
          deps.add(ws);
        }
      }
    } else if (name === "requirements.txt" || name === "requirements-dev.txt") {
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Za-z0-9_.\-]+)/);
        if (m) deps.add(m[1].toLowerCase());
      }
    } else if (name === "pyproject.toml") {
      // Minimal TOML parser for [tool.poetry.dependencies] and
      // [project] dependencies.  Avoids pulling in a TOML library.
      for (const m of content.matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*[{]/gm)) {
        deps.add(m[1].toLowerCase());
      }
    } else if (name === "go.mod") {
      for (const m of content.matchAll(/^\s*([A-Za-z0-9_.\-\/]+)\s+v[\d.]+/gm)) {
        if (!m[1].startsWith("//")) deps.add(m[1]);
      }
    } else if (name === "Cargo.toml") {
      for (const m of content.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*["']?\d/gm)) {
        deps.add(m[1]);
      }
    } else if (name === "Gemfile") {
      for (const m of content.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) {
        deps.add(m[1]);
      }
    }
  } catch {
    // ignore unparseable manifests
  }
}

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  (function walk(d: string): void {
    let entries: string[];
    try { entries = readdirSync(d) as string[]; } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && SOURCE_EXTS.has(extname(full))) out.push(full);
    }
  })(root);
  return out;
}

function scanFile(file: string, root: string, depSet: Set<string>): Hallucination[] {
  const language = inferLanguage(file);
  if (!language) return [];

  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    return [];
  }

  const imports = extractImports(content, language);
  const findings: Hallucination[] = [];
  const relPath = file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]/, "").replace(/\\/g, "/") : file;
  const builtin = new Set(BUILTIN_MODULES[language] ?? []);
  const internalModuleNames = collectInternalModuleNames(root, language);

  for (const imp of imports) {
    // Skip stdlib — both prefixed ("node:fs") and bare ("fs") specifiers
    if (builtin.has(imp.name)) continue;
    const bareName = imp.name.replace(/^node:/, "");
    if (builtin.has(bareName)) continue;
    // Skip relative imports
    if (imp.name.startsWith(".")) continue;
    // Skip known-internal modules (e.g. workspace packages)
    if (internalModuleNames.has(imp.name)) continue;
    // Skip dynamic expression-based imports like `import(`${x}`)`
    if (!imp.name || imp.name.includes("${")) continue;

    const lower = imp.name.toLowerCase();
    if (KNOWN_PHANTOM_PACKAGES.has(imp.name) || KNOWN_PHANTOM_PACKAGES.has(lower)) {
      findings.push({
        file: relPath,
        line: imp.line,
        importStatement: imp.statement,
        phantomName: imp.name,
        category: "deprecated-api",
        severity: "high",
        recommendation: `${imp.name} is a known deprecated/renamed package. Check the current package name in the language's official registry.`,
      });
      continue;
    }

    if (!depSet.has(imp.name) && !depSet.has(lower)) {
      // Could be a typo of an existing dep — check Levenshtein ≤ 2
      const similar = findSimilarDep(imp.name, depSet);
      const category: Hallucination["category"] = similar ? "typo" : "missing-dependency";
      const recommendation = similar
        ? `Did you mean "${similar}"? Add it to the manifest.`
        : `"${imp.name}" is not in the project's manifest. Add it to package.json/requirements.txt or use an existing dependency.`;
      findings.push({
        file: relPath,
        line: imp.line,
        importStatement: imp.statement,
        phantomName: imp.name,
        category,
        severity: similar ? "medium" : "high",
        recommendation,
      });
    }
  }

  return findings;
}

interface ImportMatch {
  name: string;
  line: number;
  statement: string;
}

function extractImports(content: string, language: string): ImportMatch[] {
  const lines = content.split("\n");
  const out: ImportMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    let m: RegExpMatchArray | null = null;

    if (language === "ts" || language === "js") {
      // import x from "y"
      m = line.match(/^\s*import\s+(?:[\w*${},\s]+\s+from\s+)?["']([^"']+)["']/);
      if (m) {
        const name = m[1].replace(/^node:/, "");
        // Skip relative imports — they're checked elsewhere
        if (!name.startsWith(".")) {
          out.push({ name, line: lineNo, statement: line.trim() });
        }
        continue;
      }
      // import("y")  — dynamic
      m = line.match(/import\s*\(\s*["']([^"']+)["']/);
      if (m && !m[1].startsWith(".")) {
        out.push({ name: m[1].replace(/^node:/, ""), line: lineNo, statement: line.trim() });
        continue;
      }
      // require("y")
      m = line.match(/require\s*\(\s*["']([^"']+)["']/);
      if (m && !m[1].startsWith(".")) {
        out.push({ name: m[1].replace(/^node:/, ""), line: lineNo, statement: line.trim() });
      }
    } else if (language === "py") {
      // from x import y
      m = line.match(/^\s*from\s+([\w.]+)\s+import/);
      if (m) {
        const topLevel = m[1].split(".")[0];
        out.push({ name: topLevel, line: lineNo, statement: line.trim() });
        continue;
      }
      // import x
      m = line.match(/^\s*import\s+([\w.]+)/);
      if (m) {
        const topLevel = m[1].split(".")[0];
        out.push({ name: topLevel, line: lineNo, statement: line.trim() });
      }
    } else if (language === "go") {
      // import "x"  (single-line)
      m = line.match(/^\s*import\s+"([^"]+)"/);
      if (m) { out.push({ name: m[1], line: lineNo, statement: line.trim() }); continue; }
      // "x"  (block import, line inside the block)
      m = line.match(/^\s*"([^"]+)"\s*$/);
      if (m) { out.push({ name: m[1], line: lineNo, statement: line.trim() }); continue; }
    } else if (language === "rs") {
      // use x;
      m = line.match(/^\s*use\s+([\w:]+)(?:\s*as\s+\w+)?\s*;/);
      if (m) { out.push({ name: m[1], line: lineNo, statement: line.trim() }); }
    }
  }
  return out;
}

function collectInternalModuleNames(root: string, language: string): Set<string> {
  const names = new Set<string>();
  // For Node/TS projects, walk package.json and collect workspace package names
  if (language === "ts" || language === "js") {
    (function walk(d: string): void {
      let entries: string[];
      try { entries = readdirSync(d) as string[]; } catch { return; }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(d, entry);
        let stat;
        try { stat = statSync(full); } catch { continue; }
        if (stat.isDirectory()) walk(full);
        else if (stat.isFile() && entry === "package.json") {
          try {
            const json = JSON.parse(readFileSync(full, "utf-8"));
            if (json.name) names.add(json.name);
          } catch { /* ignore */ }
        }
      }
    })(root);
  }
  return names;
}

function inferLanguage(file: string): string | null {
  const ext = extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts", ".tsx": "ts",
    ".js": "js", ".jsx": "js",
    ".py": "py", ".go": "go", ".rs": "rs",
  };
  return map[ext] ?? null;
}

/**
 * Find the closest dependency name to `target` within `deps` using
 * Levenshtein distance ≤ 2.  Returns null if no close match.
 */
function findSimilarDep(target: string, deps: Set<string>): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const dep of deps) {
    const d = levenshtein(target.toLowerCase(), dep.toLowerCase());
    if (d <= 2 && (!best || d < best.dist)) {
      best = { name: dep, dist: d };
    }
  }
  return best?.name ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
