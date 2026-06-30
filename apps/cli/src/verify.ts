// reporank verify — Quality gate command.
//
// Analyzes a file, directory, or git diff and returns a structured quality
// report. Designed to be a CI gate: exit non-zero if the quality score is
// below a threshold.
//
// Usage:
//   reporank verify <path>            # file or directory
//   reporank verify <path> --diff     # analyze git diff on stdin
//   reporank verify <path> --pr <n>   # analyze PR diff from GitHub
//   reporank verify <path> --json     # structured JSON output
//   reporank verify <path> --threshold 70
//
// Per AGENTS.md:
//  - No hardcoded URLs (read from env via ../llm.ts)
//  - No eval()
//  - Proper async error handling
//  - Files kept under 300 lines

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname, relative, isAbsolute } from "node:path";
import { heuristicScan } from "./heuristic_scanner";
import { llmScan, type Finding } from "./review_scanner";
import { dedupeFindings, capFindings } from "./util/dedupe";
import { IncrementalCache } from "./util/incremental-cache";
import { applyFixesFromVerify, type ApplyFixesFromVerifyOptions } from "./verify-apply";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "target", "vendor", ".aether_prime_cache"]);

export interface VerifyOptions {
  /** Path to file or directory to analyze */
  path: string;
  /** Minimum quality score (0-100) — exit non-zero if below */
  threshold: number;
  /** When true, read git diff from stdin and analyze only the changed lines */
  diff: boolean;
  /** PR number (currently reads the same as diff — placeholder for future) */
  pr?: number;
  /** Output format: 'json' for machine-readable, undefined for human-readable */
  format?: "json" | "gh-markdown" | "text";
  /** Skip LLM scan (heuristic only — faster, no API cost) */
  noLlm: boolean;
  /** Optional override of the LLM prompt mode */
  promptMode?: "zero-shot" | "few-shot" | "react" | "strict";
  /** Phase 1.2: detect phantom imports (LLM hallucinations of non-existent packages) */
  detectHallucinations: boolean;
}

export interface FileReport {
  path: string;
  findings: Finding[];
  /** Heuristic-only finding count, useful for fast feedback */
  heuristicFindingCount: number;
  /** LLM-augmented finding count (0 if --no-llm) */
  llmFindingCount: number;
  /** Wall-clock time for this file in ms */
  durationMs: number;
  /** Any non-fatal errors encountered */
  errors: string[];
}

export interface VerifyReport {
  /** Path that was analyzed */
  path: string;
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Per-file reports */
  files: FileReport[];
  /** Aggregated findings across all files */
  findings: Finding[];
  /** Counts by severity */
  bySeverity: Record<string, number>;
  /** Counts by category */
  byCategory: Record<string, number>;
  /** Phantom imports (Phase 1.2) — populated when --detect-hallucinations is set */
  hallucinations?: import("./hallucination-detector.js").HallucinationReport;
  /** Overall quality score 0-100 (100 = no issues, 0 = critical failures) */
  qualityScore: number;
  /** Pass/fail verdict relative to the threshold */
  passed: boolean;
  /** True if at least one LLM call was made (false = heuristic-only) */
  usedLlm: boolean;
  /** Total wall-clock duration in ms */
  durationMs: number;
  /** Configuration echoed back */
  config: {
    threshold: number;
    diff: boolean;
    noLlm: boolean;
    detectHallucinations: boolean;
  };
}

/**
 * Run the verify command. Analyzes a path, returns a structured report,
 * and returns an exit code suitable for a CI gate.
 */
export async function runVerify(opts: VerifyOptions): Promise<{ report: VerifyReport; exitCode: number }> {
  const start = Date.now();
  const absPath = resolve(opts.path);
  if (!existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  // Load project context (AGENTS.md, package.json, etc.)
  const projectContext = await loadProjectContext(absPath);

  // Collect files to analyze
  const stat = statSync(absPath);
  // When a single file is passed, the root for relative-path computation
  // is its parent directory.  When a directory is passed, the directory
  // itself is the root.
  const rootForRelative = stat.isFile() ? resolve(absPath, "..") : absPath;
  let filesToAnalyze: string[];
  if (stat.isFile()) {
    filesToAnalyze = [absPath];
  } else {
    filesToAnalyze = collectSourceFiles(absPath);
  }

  if (opts.diff) {
    // Read git diff from stdin and filter files
    const diff = await readStdin();
    if (!diff.trim()) {
      throw new Error("--diff mode requires unified diff input on stdin");
    }
    const changedFiles = parseGitDiffFiles(diff);
    // The verify path is `<cwd>/<relToVerify>` and diff files are
    // `<cwd>/<relToVerify>/<file>` (when verify was run on a subdirectory).
    // So the path matching should be `relToVerify + "/" + rel`.
    const verifyRelFromCwd = relative(process.cwd(), rootForRelative).replace(/\\/g, "/");
    filesToAnalyze = filesToAnalyze.filter((f) => {
      const rel = relative(rootForRelative, f).replace(/\\/g, "/");
      const prefixed = verifyRelFromCwd && verifyRelFromCwd !== "."
        ? `${verifyRelFromCwd}/${rel}`
        : rel;
      return changedFiles.has(prefixed) || changedFiles.has(rel);
    });
  } else if (opts.pr !== undefined) {
    // Fetch PR diff via the `gh` CLI and filter files
    const diff = await fetchPrDiff(opts.pr);
    if (!diff.trim()) {
      throw new Error(`--pr ${opts.pr} returned empty diff. Is the PR number correct?`);
    }
    const changedFiles = parseGitDiffFiles(diff);
    const verifyRelFromCwd = relative(process.cwd(), rootForRelative).replace(/\\/g, "/");
    filesToAnalyze = filesToAnalyze.filter((f) => {
      const rel = relative(rootForRelative, f).replace(/\\/g, "/");
      const prefixed = verifyRelFromCwd && verifyRelFromCwd !== "."
        ? `${verifyRelFromCwd}/${rel}`
        : rel;
      return changedFiles.has(prefixed) || changedFiles.has(rel);
    });
  }

  // Analyze each file (with content-hash incremental cache)
  const cache = new IncrementalCache(resolve(rootForRelative, ".reporank-cache.json"));
  const { createHash } = await import("node:crypto");
  const fileReports: FileReport[] = [];
  for (const file of filesToAnalyze) {
    const content = readFileSync(file, "utf-8");
    const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const cacheKey = `${file}:${contentHash}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      fileReports.push({
        path: relative(rootForRelative, file).replace(/\\/g, "/"),
        findings: cached,
        heuristicFindingCount: cached.length,
        llmFindingCount: 0,
        durationMs: 0,
        errors: [],
      });
      continue;
    }
    const report = await analyzeFile(file, rootForRelative, projectContext, opts);
    cache.set(cacheKey, report.findings);
    fileReports.push(report);
  }
  cache.flush();

  // Aggregate
  const allFindings = fileReports.flatMap((f) => f.findings);
  const bySeverity = countBy(allFindings, (f) => f.severity);
  const byCategory = countBy(allFindings, (f) => f.category);

  // Phase 1.2: detect phantom imports (LLM hallucinations of non-existent packages)
  let hallucinations: import("./hallucination-detector.js").HallucinationReport | undefined;
  if (opts.detectHallucinations) {
    const { detectHallucinations } = await import("./hallucination-detector.js");
    const filesToScanForHallucinations = fileReports.map((f) => join(rootForRelative, f.path));
    hallucinations = await detectHallucinations(rootForRelative, {
      files: filesToScanForHallucinations,
    });
  }

  // Compute quality score: combine code-review findings with hallucination penalties
  const hallucinationPenalty = hallucinations
    ? hallucinations.hallucinations.reduce((sum, h) => {
        const sev = h.severity;
        if (sev === "critical") return sum + 10;
        if (sev === "high") return sum + 5;
        if (sev === "medium") return sum + 2;
        if (sev === "low") return sum + 1;
        return sum;
      }, 0)
    : 0;
  const qualityScore = Math.max(0, computeQualityScore(allFindings, fileReports.length) - hallucinationPenalty);
  const passed = qualityScore >= opts.threshold;

  const report: VerifyReport = {
    path: absPath,
    filesAnalyzed: fileReports.length,
    files: fileReports,
    findings: allFindings,
    bySeverity,
    byCategory,
    hallucinations,
    qualityScore,
    passed,
    usedLlm: !opts.noLlm,
    durationMs: Date.now() - start,
    config: {
      threshold: opts.threshold,
      diff: opts.diff,
      noLlm: opts.noLlm,
      detectHallucinations: opts.detectHallucinations,
    },
  };

  return { report, exitCode: passed ? 0 : 1 };
}

/**
 * Compute a 0-100 quality score from findings.
 * - 100 = perfect (no findings)
 * - -10 per critical, -5 per high, -2 per medium, -1 per low, 0 per info
 * - Normalized to 0-100 range
 */
function computeQualityScore(findings: Finding[], fileCount: number): number {
  if (fileCount === 0) return 100;
  let penalty = 0;
  for (const f of findings) {
    switch (f.severity) {
      case "critical": penalty += 10; break;
      case "high": penalty += 5; break;
      case "medium": penalty += 2; break;
      case "low": penalty += 1; break;
      case "info": break;
    }
  }
  // Normalize penalty by file count to avoid penalizing large codebases
  const normalized = penalty / Math.max(1, Math.sqrt(fileCount));
  return Math.max(0, Math.round(100 - normalized));
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}



async function analyzeFile(
  filePath: string,
  rootPath: string,
  projectContext: string,
  opts: VerifyOptions,
): Promise<FileReport> {
  const start = Date.now();
  const errors: string[] = [];
  const language = inferLanguage(filePath);
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    return {
      path: relative(rootPath, filePath).replace(/\\/g, "/"),
      findings: [],
      heuristicFindingCount: 0,
      llmFindingCount: 0,
      durationMs: Date.now() - start,
      errors: [`Could not read file: ${(e as Error).message}`],
    };
  }

  // Heuristic scan — always runs.  Annotate each finding with the file path so
  // they show up correctly in the report.
  const relPath = relative(rootPath, filePath).replace(/\\/g, "/");
  const heuristic = heuristicScan(content).map((f) => ({ ...f, path: relPath })) as Finding[];

  // LLM scan — optional
  let llmFindings: Finding[] = [];
  if (!opts.noLlm) {
    try {
      const scan = await llmScan(
        {
          id: relative(rootPath, filePath).replace(/\\/g, "/"),
          language,
          code: content,
          filePath: relative(rootPath, filePath).replace(/\\/g, "/"),
          projectContext: projectContext || undefined,
        },
        { promptMode: opts.promptMode ?? "strict" },
      );
      llmFindings = scan.findings;
      errors.push(...scan.warnings);
    } catch (e) {
      errors.push(`LLM scan failed: ${(e as Error).message}`);
    }
  }

  const merged = dedupeFindings(capFindings([...heuristic, ...llmFindings]));

  return {
    path: relative(rootPath, filePath).replace(/\\/g, "/"),
    findings: merged,
    heuristicFindingCount: heuristic.length,
    llmFindingCount: llmFindings.length,
    durationMs: Date.now() - start,
    errors,
  };
}

function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "ts", ".tsx": "ts",
    ".js": "js", ".jsx": "js",
    ".py": "py", ".go": "go", ".rs": "rs", ".java": "java", ".rb": "rb",
  };
  return map[ext] ?? "text";
}

async function loadProjectContext(rootPath: string): Promise<string> {
  // Try AGENTS.md, .cursorrules, CLAUDE.md — first one wins
  const candidates = ["AGENTS.md", ".cursorrules", "CLAUDE.md", "README.md"];
  for (const name of candidates) {
    const path = join(rootPath, name);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8").slice(0, 4000);
      } catch {
        // ignore
      }
    }
  }
  return "";
}

function collectSourceFiles(rootPath: string): string[] {
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
  })(rootPath);
  return out;
}

function readStdinSync(): string {
  // Kept for backwards compat but prefer readStdin() async.
  try {
    return readFileSync("/dev/stdin", "utf-8");
  } catch {
    try {
      return readFileSync(0 as any, "utf-8");
    } catch {
      return "";
    }
  }
}

/**
 * Read all of stdin asynchronously.  Returns empty string if stdin is a
 * TTY (interactive terminal) rather than a pipe.
 *
 * Uses async iteration rather than a timeout-based race because:
 *  - In CLI tools, stdin should normally finish when the upstream process
 *    closes the pipe, not when a local timeout fires.
 *  - A 2s fallback can resolve before all piped diff data arrives,
 *    especially on Windows or when the producer is slow.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

/**
 * Parse a unified diff and return the set of changed file paths (forward-slash).
 * Supports both `+++ b/path/to/file` and `--- a/path/to/file` formats.
 */
function parseGitDiffFiles(diff: string): Set<string> {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) files.add(line.slice(6).trim());
    else if (line.startsWith("--- a/")) files.add(line.slice(6).trim());
  }
  return files;
}

/**
 * Fetch a PR's unified diff using the `gh` CLI.  Returns the diff text or
 * throws with a helpful error if `gh` is missing or the PR doesn't exist.
 */
async function fetchPrDiff(prNumber: number): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolveP, rejectP) => {
    execFile(
      "gh",
      ["pr", "diff", String(prNumber)],
      { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          rejectP(new Error(`gh pr diff ${prNumber} failed: ${stderr || err.message}`));
          return;
        }
        resolveP(stdout);
      },
    );
  });
}

