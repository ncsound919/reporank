// Content-hash cache and delta analyzer (Dimension 5 — large project support).
//
// For projects with >10K files, re-analyzing every file on every scan is
// prohibitive.  This module provides:
//   1. A content-hash cache: SHA-256 of file content → cached analysis result
//   2. A git-aware delta analyzer: only re-analyze files changed since the
//      last scan
//   3. A bulk-scan driver: combine cache + delta + heuristic scanner
//
// Per AGENTS.md: no eval(), no hardcoded URLs (env-driven), proper async
// error handling, files under 300 lines.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
import { heuristicScan } from "./heuristic_scanner";
import { llmScan } from "./review_scanner";
import type { Finding } from "./review_scanner";

// ─── Types ─────────────────────────────────────────────────────

export interface CacheEntry {
  /** SHA-256 of file content (hex) */
  contentHash: string;
  /** Path relative to the repo root */
  filePath: string;
  /** When this entry was created/updated (epoch ms) */
  timestamp: number;
  /** Cached analysis result (heuristic + LLM findings) */
  findings: Finding[];
  /** Model version that produced the findings */
  model: string;
}

export interface CacheState {
  version: 1;
  repoRoot: string;
  /** Map: filePath -> CacheEntry */
  entries: Record<string, CacheEntry>;
  /** Last full scan timestamp (epoch ms) */
  lastFullScan?: number;
}

export interface DeltaResult {
  /** Files that changed since the last scan (need re-analysis) */
  changed: string[];
  /** Files unchanged (use cache) */
  unchanged: string[];
  /** Files in the repo but not in cache (need initial analysis) */
  new: string[];
  /** Files in cache but no longer in the repo */
  deleted: string[];
  /** Cache hit ratio (0..1) */
  cacheHitRate: number;
}

export interface BulkScanOptions {
  repoRoot: string;
  /** Use LLM in addition to heuristics (default: false) */
  useLlm?: boolean;
  /** Languages to consider (default: common source extensions) */
  extensions?: Set<string>;
  /** Max files to process in one batch (default: 500) */
  maxFiles?: number;
  /** Concurrency for LLM calls (default: 2) */
  concurrency?: number;
}

export interface BulkScanResult {
  totalFiles: number;
  cachedFiles: number;
  analyzedFiles: number;
  totalFindings: number;
  durationMs: number;
  findingsByFile: Record<string, Finding[]>;
  cacheHitRate: number;
  errors: Array<{ file: string; error: string }>;
}

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb"]);
const CACHE_VERSION = 1;

// ─── Cache file location ─────────────────────────────────────────
// Each repo gets its own cache at <repoRoot>/.mutly-cache.json.
// Can be overridden with MUTLY_CACHE_DIR env var.
function cachePathFor(repoRoot: string): string {
  if (process.env.MUTLY_CACHE_DIR) {
    const dir = process.env.MUTLY_CACHE_DIR;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, `${hashSlug(repoRoot)}.json`);
  }
  return join(repoRoot, ".mutly-cache.json");
}

function hashSlug(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// ─── Cache I/O ──────────────────────────────────────────────────

export function loadCache(repoRoot: string): CacheState {
  const path = cachePathFor(repoRoot);
  if (process.env.MUTLY_DEBUG) console.error(`[cache] loading from ${path}`);
  if (!existsSync(path)) {
    if (process.env.MUTLY_DEBUG) console.error(`[cache] file does not exist, returning empty`);
    return { version: CACHE_VERSION, repoRoot, entries: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (raw.version !== CACHE_VERSION) {
      if (process.env.MUTLY_DEBUG) console.error(`[cache] version mismatch, returning empty`);
      return { version: CACHE_VERSION, repoRoot, entries: {} };
    }
    if (process.env.MUTLY_DEBUG) console.error(`[cache] loaded ${Object.keys(raw.entries || {}).length} entries`);
    return raw as CacheState;
  } catch (e) {
    if (process.env.MUTLY_DEBUG) console.error(`[cache] parse error: ${(e as Error).message}`);
    return { version: CACHE_VERSION, repoRoot, entries: {} };
  }
}

export function saveCache(state: CacheState): void {
  const path = cachePathFor(state.repoRoot);
  if (process.env.MUTLY_DEBUG) console.error(`[cache] writing to ${path} (${Object.keys(state.entries).length} entries)`);
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
    if (process.env.MUTLY_DEBUG) console.error(`[cache] write OK`);
  } catch (e) {
    // Best-effort — don't crash the scan on a write failure
    console.error(`[cache] failed to write ${path}: ${(e as Error).message}`);
  }
}

// ─── Content hash ──────────────────────────────────────────────

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ─── File walker ────────────────────────────────────────────────

function walkSourceFiles(repoRoot: string, extensions: Set<string>): string[] {
  const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "coverage",
    ".next", ".cache", ".turbo", "target", "vendor", ".mutly-cache",
  ]);
  const out: string[] = [];
  (function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (extensions.has(full.slice(full.lastIndexOf(".")))) out.push(full);
    }
  })(repoRoot);
  return out;
}

// ─── Git delta ──────────────────────────────────────────────────

export interface GitDelta {
  changed: string[];
  /** Last commit hash at scan time */
  commit: string | null;
}

export function gitDelta(repoRoot: string, sinceCommit?: string): GitDelta {
  try {
    const base = sinceCommit ? `${sinceCommit}..HEAD` : "HEAD";
    const out = execSync(`git diff --name-only ${base}`, {
      cwd: repoRoot, encoding: "utf-8", timeout: 10000,
    });
    const headCommit = execSync(`git rev-parse HEAD`, {
      cwd: repoRoot, encoding: "utf-8", timeout: 5000,
    }).trim();
    return {
      changed: out.split("\n").map((s) => s.trim()).filter(Boolean),
      commit: headCommit,
    };
  } catch {
    return { changed: [], commit: null };
  }
}

// ─── Delta computation ─────────────────────────────────────────

export function computeDelta(
  state: CacheState,
  currentFiles: string[],
  useGit: boolean = true,
): DeltaResult {
  const currentSet = new Set(currentFiles);
  const cachedSet = new Set(Object.keys(state.entries));
  const newFiles: string[] = [];
  const deleted: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const f of currentFiles) {
    if (!cachedSet.has(f)) {
      newFiles.push(f);
    } else {
      // Compare content hash
      try {
        const content = readFileSync(f, "utf-8");
        const hash = contentHash(content);
        if (state.entries[f].contentHash === hash) {
          unchanged.push(f);
        } else {
          changed.push(f);
          if (process.env.MUTLY_DEBUG) {
            console.error(`[delta] ${f}: content changed (old=${state.entries[f].contentHash.slice(0, 8)} new=${hash.slice(0, 8)})`);
          }
        }
      } catch {
        // File unreadable — treat as new
        newFiles.push(f);
      }
    }
  }
  for (const f of cachedSet) {
    if (!currentSet.has(f)) deleted.push(f);
  }

  // If git is available, override the changed list with git's view
  if (useGit) {
    const gd = gitDelta(state.repoRoot);
    if (gd.commit && gd.changed.length > 0) {
      // Map git paths to absolute
      const absChanged = new Set(gd.changed.map((p) => join(state.repoRoot, p)));
      // Re-classify: any file that git says is changed is "changed"
      for (const f of [...unchanged, ...newFiles]) {
        if (absChanged.has(f)) {
          // Move from new/unchanged to changed
          if (newFiles.includes(f)) newFiles.splice(newFiles.indexOf(f), 1);
          if (unchanged.includes(f)) unchanged.splice(unchanged.indexOf(f), 1);
          changed.push(f);
        }
      }
    }
  }

  const total = currentFiles.length;
  const cacheHitRate = total > 0 ? unchanged.length / total : 0;

  return { changed, unchanged, new: newFiles, deleted, cacheHitRate };
}

// ─── Bulk scan driver ──────────────────────────────────────────

export async function bulkScan(opts: BulkScanOptions): Promise<BulkScanResult> {
  const start = Date.now();
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const maxFiles = opts.maxFiles ?? 500;
  const useLlm = opts.useLlm ?? false;

  const state = loadCache(opts.repoRoot);
  const allFiles = walkSourceFiles(opts.repoRoot, extensions).slice(0, maxFiles);
  const delta = computeDelta(state, allFiles);

  const toAnalyze = [...delta.changed, ...delta.new];
  const findingsByFile: Record<string, Finding[]> = {};
  const errors: Array<{ file: string; error: string }> = [];

  // Reuse cached findings for unchanged files
  for (const f of delta.unchanged) {
    findingsByFile[f] = state.entries[f].findings;
  }

  // Analyze new + changed files
  const concurrency = opts.concurrency ?? 2;
  const queue = [...toAnalyze];
  const inFlight: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    inFlight.push(worker(queue, findingsByFile, state, opts.repoRoot, useLlm, errors));
  }
  await Promise.all(inFlight);

  // Clean up deleted entries
  for (const d of delta.deleted) delete state.entries[d];

  // Update lastFullScan timestamp
  if (delta.new.length === 0 && delta.changed.length === 0) {
    state.lastFullScan = Date.now();
  }

  saveCache(state);

  const totalFindings = Object.values(findingsByFile).reduce((s, f) => s + f.length, 0);

  return {
    totalFiles: allFiles.length,
    cachedFiles: delta.unchanged.length,
    analyzedFiles: toAnalyze.length,
    totalFindings,
    durationMs: Date.now() - start,
    findingsByFile,
    cacheHitRate: delta.cacheHitRate,
    errors,
  };
}

async function worker(
  queue: string[],
  out: Record<string, Finding[]>,
  state: CacheState,
  repoRoot: string,
  useLlm: boolean,
  errors: Array<{ file: string; error: string }>,
): Promise<void> {
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file) return;
    try {
      const content = readFileSync(file, "utf-8");
      const findings: Finding[] = [];

      // Always run heuristic
      findings.push(...heuristicScan(content));

      // Optionally run LLM
      if (useLlm) {
        try {
          const scan = await llmScan({
            id: relative(repoRoot, file),
            language: "auto",
            code: content,
          });
          findings.push(...scan.findings);
        } catch (e) {
          // LLM failed — keep heuristic findings
        }
      }

      out[file] = findings;
      state.entries[file] = {
        contentHash: contentHash(content),
        filePath: relative(repoRoot, file),
        timestamp: Date.now(),
        findings,
        model: useLlm ? "llm+heuristic" : "heuristic",
      };
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
    }
  }
}
