/**
 * loader.ts — load local repos into the in-memory shape the analyzers expect.
 *
 * The GitHub scanner builds `sourceFiles` from the network. Portfolio work
 * needs the same shape from a local checkout, deterministically. This loader
 * walks a directory, skips build/vendor dirs, reads source files (with a size
 * cap), and infers the main language from extension counts. It is the only
 * place that touches the filesystem for portfolio input.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { normalizePath, type GraphSourceFile } from "../analyzers/import-graph";
import { runDeepAnalysis, type DeepAnalysisReport } from "../analyzers/run-deep-analysis";
import { computeStructuralIndex, type StructuralIndex } from "../analyzers/structural-index";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  "target",
  "vendor",
  ".reporank",
  ".mutly-cache",
]);

export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "javascript",
  ".svelte": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
};

const MAX_FILE_BYTES = 200_000;

export interface LoadedRepo {
  root: string;
  name: string;
  packageName?: string;
  mainLanguage: string;
  fileTree: string[];
  sourceFiles: GraphSourceFile[];
  packageJson: string;
  totalLoc: number;
}

export interface LoadRepoOptions {
  maxFileBytes?: number;
  extensions?: Set<string>;
}

/** A directory is treated as a repo when it has a package.json or a .git dir. */
export function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, "package.json")) || existsSync(join(dir, ".git"));
}

/** Immediate child directories of `root` that look like repos (sorted). */
export function discoverRepos(root: string): string[] {
  if (!existsSync(root)) return [];
  if (isRepoRoot(root)) return [root];
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  return entries.map((entry) => join(root, entry)).filter(isRepoRoot);
}

function walk(dir: string, extensions: Set<string>, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), extensions, out);
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      out.push(join(dir, entry.name));
    }
  }
}

function inferLanguageFromPaths(paths: string[]): string {
  if (paths.length === 0) return "unknown";
  const counts = new Map<string, number>();
  for (const path of paths) {
    const language = LANGUAGE_BY_EXT[extname(path).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  if (counts.size === 0) return "unknown";
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function inferLanguage(paths: string[]): string {
  return inferLanguageFromPaths(paths);
}

export function countLoc(sourceFiles: GraphSourceFile[]): number {
  return sourceFiles.reduce((sum, file) => sum + file.content.split(/\r?\n/).length, 0);
}

function readPackageName(packageJson: string): string | undefined {
  try {
    const parsed = JSON.parse(packageJson) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

/** Read a local repo into analyzable in-memory source files. */
export function loadRepo(root: string, options: LoadRepoOptions = {}): LoadedRepo {
  const extensions = options.extensions ?? SOURCE_EXTENSIONS;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const absoluteRoot = root;

  const absoluteFiles: string[] = [];
  walk(absoluteRoot, extensions, absoluteFiles);
  absoluteFiles.sort();

  const sourceFiles: GraphSourceFile[] = [];
  for (const absolute of absoluteFiles) {
    try {
      if (statSync(absolute).size > maxFileBytes) continue;
      const content = readFileSync(absolute, "utf-8");
      sourceFiles.push({ path: normalizePath(relative(absoluteRoot, absolute)), content });
    } catch {
      // Unreadable file: skip rather than fail the whole repo.
    }
  }
  sourceFiles.sort((a, b) => a.path.localeCompare(b.path));

  const packageJsonPath = join(absoluteRoot, "package.json");
  let packageJson = "";
  try {
    if (existsSync(packageJsonPath) && statSync(packageJsonPath).size <= maxFileBytes) {
      packageJson = readFileSync(packageJsonPath, "utf-8");
    }
  } catch {
    packageJson = "";
  }

  const fileTree = sourceFiles.map((file) => file.path);
  return {
    root: absoluteRoot,
    name: readPackageName(packageJson) ?? basename(absoluteRoot) ?? "repo",
    packageName: readPackageName(packageJson),
    mainLanguage: inferLanguageFromPaths(fileTree),
    fileTree,
    sourceFiles,
    packageJson,
    totalLoc: countLoc(sourceFiles),
  };
}

export interface RepoAnalysis {
  index: StructuralIndex;
  deep: DeepAnalysisReport;
}

/** Run the deterministic analyzers and index over a loaded repo. */
export function analyzeLoadedRepo(loaded: LoadedRepo): RepoAnalysis {
  const deep = runDeepAnalysis(loaded.root, loaded.fileTree, loaded.sourceFiles, loaded.packageJson);
  const index = computeStructuralIndex(deep, {
    mainLanguage: loaded.mainLanguage,
    totalLoc: loaded.totalLoc,
    structure: deep.structure,
    deadCode: deep.deadCode,
  });
  return { index, deep };
}
