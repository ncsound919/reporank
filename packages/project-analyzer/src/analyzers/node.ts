import fs from "node:fs/promises";
import path from "node:path";

type ScriptMap = Record<string, string>;

interface PackageJsonLike {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  packageManager?: unknown;
}

export interface NodeAnalysisResult {
  found: boolean;
  hasEslint: boolean;
  hasVitest: boolean;
  hasJest: boolean;
  hasTypeScript: boolean;
  scripts: ScriptMap;
  packageManager?: string;
  error?: string;
}

export async function analyzeNode(dir: string): Promise<NodeAnalysisResult> {
  const pkgJsonPath = path.join(dir, "package.json");

  try {
    const content = await fs.readFile(pkgJsonPath, "utf8");
    const parsed = safeParseJson(content);

    if (!isPackageJsonLike(parsed)) {
      return failureResult("package.json exists but is not a valid object");
    }

    return {
      found: true,
      hasEslint: hasDependency(parsed, "eslint"),
      hasVitest: hasDependency(parsed, "vitest"),
      hasJest: hasDependency(parsed, "jest"),
      hasTypeScript: hasDependency(parsed, "typescript"),
      scripts: normalizeScripts(parsed.scripts),
      packageManager: await detectPackageManager(dir, parsed),
    };
  } catch (error: unknown) {
    return failureResult(error instanceof Error ? error.message : String(error));
  }
}

function safeParseJson(content: string): unknown {
  return JSON.parse(content) as unknown;
}

function isPackageJsonLike(value: unknown): value is PackageJsonLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDependency(pkg: PackageJsonLike, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

function normalizeScripts(value: unknown): ScriptMap {
  if (!isRecord(value)) {
    return {};
  }

  const scripts: ScriptMap = {};
  for (const [key, script] of Object.entries(value)) {
    if (typeof script === "string") {
      scripts[key] = script;
    }
  }
  return scripts;
}

async function detectPackageManager(
  dir: string,
  pkg: PackageJsonLike,
): Promise<string | undefined> {
  if (typeof pkg.packageManager === "string") {
    return pkg.packageManager;
  }

  const lockfiles: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
  ];

  for (const [filename, manager] of lockfiles) {
    try {
      await fs.access(path.join(dir, filename));
      return manager;
    } catch {
      // continue
    }
  }

  return undefined;
}

function failureResult(error: string): NodeAnalysisResult {
  return {
    found: false,
    hasEslint: false,
    hasVitest: false,
    hasJest: false,
    hasTypeScript: false,
    scripts: {},
    error,
  };
}
