#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const VIBESERVE_URL = readEnv("VIBESERVE_URL");
const VIBESERVE_API_KEY = readEnv("VIBESERVE_API_KEY");
const GRAPH_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 120_000;
const MAX_AFFECTED_FILES = 10;
const MAX_FILE_CONTEXT = 6_000;

export interface BlastRadiusResult {
  target: string;
  total_affected: number;
  max_depth: number;
  by_file: Array<{ file: string; symbols: string[]; depth: number }>;
  files_to_edit: string[];
  symbols_to_rename: string[];
  test_files?: string[];
}

export interface RefactorEdit {
  filePath: string;
  findContent: string;
  replaceContent: string;
  confidence: number;
  symbol: string;
}

export interface RefactorPlan {
  request: string;
  blast: BlastRadiusResult;
  edits: RefactorEdit[];
  skippedFiles: Array<{ file: string; reason: string }>;
  risk: "low" | "medium" | "high";
  warnings: string[];
  totalEdits: number;
  estimatedFilesChanged: number;
  durationMs: number;
}

type JsonObject = Record<string, unknown>;

function readEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildHeaders(): Record<string, string> {
  return VIBESERVE_API_KEY ? { "X-VibeServe-API-Key": VIBESERVE_API_KEY } : {};
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRelPath(root: string, filePath: string): string {
  return relative(root, filePath).replace(/\\/g, "/");
}

function isInsideRepo(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function resolveRepoFile(root: string, filePath: string): string | null {
  const full = resolve(root, filePath);
  return isInsideRepo(root, full) ? full : null;
}

function isTestFile(file: string): boolean {
  return /(^|[\/\\])(__tests__|tests|test|spec|specs)[\/\\]/i.test(file) || /\.(test|spec)\.[a-z]+$/i.test(file);
}

function isSkippablePath(file: string): boolean {
  return /(^|[\/\\])(node_modules|\.git|dist|build|coverage|\.next|target|vendor)[\/\\]/.test(file);
}

function isSkippableFile(file: string): boolean {
  return /\.(lock|log|min\.js|bundle\.js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|mp[34]|zip|tar|gz|wasm)$/i.test(file);
}

function extractTarget(request: string): string {
  const match =
    request.match(/(?:rename|change|update|refactor)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i) ||
    request.match(/`([A-Za-z_$][\w$]*)`/);
  return match?.[1] ?? "";
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as JsonObject) : null;
    } catch {
      return null;
    }
  }
}

async function tryCodeGraphImpact(
  repoPath: string,
  target: string,
  direction: "upstream" | "downstream",
): Promise<BlastRadiusResult | null> {
  if (!VIBESERVE_URL || !target) return null;

  try {
    const body = await fetchJson<{
      status?: string;
      impact?: Record<string, Array<Record<string, unknown>>>;
    }>(
      `${VIBESERVE_URL}/tools/codegraph_impact`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildHeaders() },
        body: JSON.stringify({
          target,
          direction,
          repo_key: repoPath.replace(/[\\/]/g, "/"),
          max_depth: 3,
        }),
      },
      GRAPH_TIMEOUT_MS,
    );

    if (body.status !== "ok" || !body.impact) return null;

    const fileSet = new Set<string>();
    const byFileMap = new Map<string, { symbols: string[]; depth: number }>();
    const levels = [
      { key: "will_break", depth: 1 },
      { key: "likely_affected", depth: 2 },
      { key: "might_affect", depth: 3 },
    ] as const;

    for (const { key, depth } of levels) {
      for (const item of body.impact[key] ?? []) {
        const file = typeof item.file === "string" ? item.file : typeof item.source_file === "string" ? item.source_file : null;
        if (!file) continue;

        fileSet.add(file);
        const slot = byFileMap.get(file) ?? { symbols: [], depth };
        const symbol =
          typeof item.symbol === "string"
            ? item.symbol
            : typeof item.name === "string"
              ? item.name
              : target;

        slot.symbols.push(symbol);
        slot.depth = Math.min(slot.depth, depth);
        byFileMap.set(file, slot);
      }
    }

    const byFile = [...byFileMap.entries()].map(([file, value]) => ({
      file,
      symbols: value.symbols,
      depth: value.depth,
    }));

    return {
      target,
      total_affected: byFile.reduce((sum, item) => sum + item.symbols.length, 0),
      max_depth: 3,
      by_file: byFile,
      files_to_edit: [...fileSet],
      symbols_to_rename: [target],
    };
  } catch {
    return null;
  }
}

function collectSourceFiles(root: string): string[] {
  const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb"]);
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "target", "vendor"]);
  const files: string[] = [];

  (function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);

      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        walk(full);
      } else if (sourceExts.has(extname(full))) {
        files.push(full);
      }
    }
  })(root);

  return files;
}

async function getBlastRadius(
  repoPath: string,
  target: string,
  direction: "upstream" | "downstream" = "upstream",
): Promise<BlastRadiusResult> {
  const root = resolve(repoPath);
  if (!existsSync(root) || !target) {
    return {
      target,
      total_affected: 0,
      max_depth: 0,
      by_file: [],
      files_to_edit: [],
      symbols_to_rename: [],
    };
  }

  const graphResult = await tryCodeGraphImpact(root, target, direction);
  if (graphResult && graphResult.total_affected > 0) {
    return graphResult;
  }

  const files = collectSourceFiles(root);
  const targetRe = new RegExp(`\\b${escapeRegex(target)}\\b`);
  const defRe = new RegExp(`\\b(function|class|const|let|var|def|interface|type|export)\\s+${escapeRegex(target)}\\b`);
  const byFile = new Map<string, { matches: string[]; hasDefinition: boolean }>();

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const matches: string[] = [];
    let hasDefinition = false;

    for (const line of content.split("\n")) {
      if (!targetRe.test(line)) continue;
      matches.push(line.trim());
      if (defRe.test(line)) hasDefinition = true;
    }

    if (matches.length > 0) {
      byFile.set(file, { matches, hasDefinition });
    }
  }

  const entries = [...byFile.entries()].map(([file, value]) => ({
    file: normalizeRelPath(root, file),
    symbols: value.matches,
    depth: value.hasDefinition ? 1 : 2,
  }));

  const allMatchedFiles = entries.map((entry) => entry.file);
  const testFiles = allMatchedFiles.filter(isTestFile);
  const productionFiles = allMatchedFiles.filter((file) => !isTestFile(file));

  return {
    target,
    total_affected: [...byFile.values()].reduce((sum, item) => sum + item.matches.length, 0),
    max_depth: 2,
    by_file: entries,
    files_to_edit: productionFiles,
    symbols_to_rename: [target],
    test_files: testFiles,
  };
}

function buildFileContext(content: string, target: string): string {
  const lines = content.split("\n");
  const targetRe = new RegExp(`\\b${escapeRegex(target)}\\b`);
  const indexes: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (targetRe.test(lines[i])) indexes.push(i);
  }

  if (indexes.length === 0) {
    return content.slice(0, 3_000);
  }

  const seen = new Set<number>();
  const picked: string[] = [];

  for (const index of indexes) {
    for (let i = Math.max(0, index - 50); i < Math.min(lines.length, index + 30); i++) {
      if (seen.has(i)) continue;
      seen.add(i);
      picked.push(lines[i]);
    }
  }

  return picked.join("\n").slice(0, MAX_FILE_CONTEXT);
}

async function proposeEdits(
  request: string,
  blast: BlastRadiusResult,
  repoPath: string,
  target: string,
): Promise<RefactorEdit[]> {
  if (!VIBESERVE_URL) {
    throw new Error("VIBESERVE_URL is not configured");
  }

  const affectedContent: Record<string, string> = {};
  for (const file of blast.files_to_edit.slice(0, MAX_AFFECTED_FILES)) {
    const full = resolveRepoFile(repoPath, file);
    if (!full) continue;

    try {
      affectedContent[file] = buildFileContext(readFileSync(full, "utf-8"), target);
    } catch {
      continue;
    }
  }

  const prompt = `You are a senior engineer doing a coordinated multi-file refactor.

Request: ${request}
Blast radius: ${blast.total_affected} references across ${blast.files_to_edit.length} file(s)

Affected files:
${Object.entries(affectedContent).map(([file, content]) => `\n--- ${file} ---\n${content}`).join("\n")}

Return a JSON object with this exact shape:
{
  "edits": [
    {
      "file": "path/to/file.ts",
      "find": "the EXACT text to find (copy-paste from the file, preserving whitespace)",
      "replace": "what to replace it with",
      "symbol": "the symbol being changed",
      "confidence": 0.0
    }
  ]
}

CRITICAL RULES:
- One edit object per file
- Every "find" string MUST be a verbatim substring of the file
- "replace" must be the exact new text
- Prefer the smallest possible find/replace block
- Skip any edit where confidence < 0.6
- If the refactor is unclear, return {"edits": []}

Return strict JSON only. No prose, no markdown.`;

  const body = await fetchJson<{
    status?: string;
    error?: string;
    content?: string;
  }>(
    `${VIBESERVE_URL}/v1/llm/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildHeaders() },
      body: JSON.stringify({ prompt, response_format: "json", temperature: 0.1 }),
    },
    LLM_TIMEOUT_MS,
  );

  if (body.status !== "success" || typeof body.content !== "string") {
    throw new Error(body.error || "LLM returned an invalid response");
  }

  const parsed = parseJsonObject(body.content);
  const edits = parsed?.edits;

  if (!Array.isArray(edits)) return [];

  return edits
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      filePath: typeof item.file === "string" ? item.file : "",
      findContent: typeof item.find === "string" ? item.find : "",
      replaceContent: typeof item.replace === "string" ? item.replace : "",
      confidence: typeof item.confidence === "number" ? item.confidence : 0,
      symbol: typeof item.symbol === "string" ? item.symbol : target,
    }))
    .filter((edit) => edit.filePath && edit.findContent && edit.replaceContent);
}

function validateEdits(
  edits: RefactorEdit[],
  repoPath: string,
): { valid: RefactorEdit[]; skipped: Array<{ file: string; reason: string }>; warnings: string[] } {
  const valid: RefactorEdit[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const warnings: string[] = [];
  const seenFiles = new Set<string>();

  for (const edit of edits) {
    const normalizedPath = edit.filePath.replace(/\\/g, "/");

    if (seenFiles.has(normalizedPath)) {
      skipped.push({ file: normalizedPath, reason: "Duplicate file edit; only one edit per file is allowed" });
      continue;
    }
    if (isSkippablePath(normalizedPath)) {
      skipped.push({ file: normalizedPath, reason: "Generated/path-skipped" });
      continue;
    }
    if (isSkippableFile(normalizedPath)) {
      skipped.push({ file: normalizedPath, reason: "Binary/lockfile" });
      continue;
    }
    if (edit.confidence < 0.6) {
      skipped.push({ file: normalizedPath, reason: "Low-confidence edit" });
      continue;
    }
    if (!edit.findContent.trim()) {
      skipped.push({ file: normalizedPath, reason: "Empty find block" });
      continue;
    }
    if (edit.findContent === edit.replaceContent) {
      skipped.push({ file: normalizedPath, reason: "No-op edit" });
      continue;
    }

    const full = resolveRepoFile(repoPath, normalizedPath);
    if (!full) {
      skipped.push({ file: normalizedPath, reason: "Path escapes repo root" });
      continue;
    }

    let fileContent: string;
    try {
      fileContent = readFileSync(full, "utf-8");
    } catch (error) {
      skipped.push({
        file: normalizedPath,
        reason: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (!fileContent.includes(edit.findContent)) {
      skipped.push({ file: normalizedPath, reason: "Find block not found in file" });
      continue;
    }

    if (edit.findContent.length > 10_000) {
      warnings.push(`Large find block in ${normalizedPath} (${edit.findContent.length} chars)`);
    }

    seenFiles.add(normalizedPath);
    valid.push({ ...edit, filePath: normalizedPath });
  }

  return { valid, skipped, warnings };
}

function assessRisk(blast: BlastRadiusResult, edits: RefactorEdit[]): "low" | "medium" | "high" {
  if (blast.total_affected > 50 || edits.length > 15) return "high";
  if (blast.total_affected > 10 || edits.length > 5) return "medium";
  return "low";
}

export async function runRefactor(repoPath: string, request: string): Promise<RefactorPlan> {
  const start = Date.now();
  const warnings: string[] = [];
  const root = resolve(repoPath);
  const target = extractTarget(request);

  if (!existsSync(root)) {
    return {
      request,
      blast: {
        target,
        total_affected: 0,
        max_depth: 0,
        by_file: [],
        files_to_edit: [],
        symbols_to_rename: [],
      },
      edits: [],
      skippedFiles: [],
      risk: "low",
      warnings: [`Repo path not found: ${root}`],
      totalEdits: 0,
      estimatedFilesChanged: 0,
      durationMs: Date.now() - start,
    };
  }

  const blast = await getBlastRadius(root, target);
  if (!target) {
    warnings.push("Could not infer a target symbol from the request.");
  } else if (blast.total_affected === 0) {
    warnings.push(`Symbol "${target}" not found in repo. Check the spelling.`);
  }

  if (blast.test_files?.length) {
    warnings.push(
      `${blast.test_files.length} test file(s) reference "${target}". Tests are reported but not edited.`,
    );
  }

  let edits: RefactorEdit[] = [];
  if (blast.total_affected > 0) {
    try {
      edits = await proposeEdits(request, blast, root, target);
    } catch (error) {
      warnings.push(`LLM edit proposal failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const validated = validateEdits(edits, root);
  warnings.push(...validated.warnings);

  return {
    request,
    blast,
    edits: validated.valid,
    skippedFiles: validated.skipped,
    risk: assessRisk(blast, validated.valid),
    warnings,
    totalEdits: validated.valid.length,
    estimatedFilesChanged: new Set(validated.valid.map((edit) => edit.filePath)).size,
    durationMs: Date.now() - start,
  };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write("Usage: tsx refactor-orchestrator.ts <repo-path> <request>\n");
    process.stderr.write('Example: tsx refactor-orchestrator.ts ./jobclaw "rename getUserByName to findUser"\n');
    return 1;
  }

  const repoPath = resolve(args[0]);
  const request = args.slice(1).join(" ");

  process.stdout.write("\nRefactor orchestrator\n");
  process.stdout.write(`Repo:    ${repoPath}\n`);
  process.stdout.write(`Request: ${request}\n\n`);

  const plan = await runRefactor(repoPath, request);

  process.stdout.write(`Blast radius: ${plan.blast.total_affected} references across ${plan.blast.files_to_edit.length} file(s)\n`);
  process.stdout.write(`Edits:        ${plan.totalEdits} (${plan.estimatedFilesChanged} files will change)\n`);
  process.stdout.write(`Risk:         ${plan.risk.toUpperCase()}\n`);
  process.stdout.write(`Duration:     ${plan.durationMs}ms\n`);

  if (plan.warnings.length > 0) {
    process.stdout.write("\nWarnings:\n");
    for (const warning of plan.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }

  if (plan.edits.length === 0) {
    process.stdout.write("\nNo edits proposed. Nothing to apply.\n");
    return 0;
  }

  process.stdout.write("\nProposed edits:\n");
  for (const edit of plan.edits) {
    const findPreview = edit.findContent.split("\n").slice(0, 5).join("\n").slice(0, 100);
    const replacePreview = edit.replaceContent.split("\n").slice(0, 5).join("\n").slice(0, 100);
    process.stdout.write(`- ${edit.filePath} (${edit.symbol}, conf=${(edit.confidence * 100).toFixed(0)}%)\n`);
    process.stdout.write(`  - ${findPreview}${edit.findContent.length > 100 ? "..." : ""}\n`);
    process.stdout.write(`  + ${replacePreview}${edit.replaceContent.length > 100 ? "..." : ""}\n`);
  }

  const patchPath = resolve("./refactor-patch.json");
  const patch = {
    edits: plan.edits.map((edit) => ({
      filePath: edit.filePath,
      findContent: edit.findContent,
      replaceContent: edit.replaceContent,
    })),
  };

  writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, "utf-8");
  process.stdout.write(`\nPatch written to ${patchPath}\n`);
  process.stdout.write("Apply with VS Code command: mutly.applyMultiFile\n");
  return 0;
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`Orchestrator crashed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
