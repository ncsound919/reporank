#!/usr/bin/env node
// Multi-file refactor orchestrator (Dimension 4).
//
// Given a refactor request (e.g. "rename function X to Y in this repo"),
// 1. Asks the code graph for blast radius (what symbols depend on X?)
// 2. Asks the LLM to generate a coordinated multi-file patch
// 3. Validates the patch structure (every file path is unique, every find
//    block is non-empty, no destructive changes to lock files)
// 4. Returns a JSON patch that the VS Code extension can apply via
//    `mutly.applyMultiFile`
//
// Usage: tsx refactor-orchestrator.ts <repo-path> <request>
// Example: tsx refactor-orchestrator.ts ./jobclaw "rename getUserByName to findUser"

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const VIBESERVE_URL = process.env.VIBESERVE_URL || "http://127.0.0.1:8000";
const VIBESERVE_API_KEY = process.env.VIBESERVE_API_KEY || "benchmark-secret-2024";
const AUTH_HEADERS = { "X-VibeServe-API-Key": VIBESERVE_API_KEY };

// ─── Types ────────────────────────────────────────────────────
export interface BlastRadiusResult {
  target: string;
  total_affected: number;
  max_depth: number;
  by_file: Array<{ file: string; symbols: string[]; depth: number }>;
  /** The set of files we will need to edit.  Excludes the target itself and
   *  test files (test files are consumers of the public API, not sources
   *  that need renaming). */
  files_to_edit: string[];
  /** Symbols that will need their references updated. */
  symbols_to_rename: string[];
  /** Test files that reference the target but are not in files_to_edit.
   *  Surfaced so callers can warn the user without editing them. */
  test_files?: string[];
}

export interface RefactorEdit {
  filePath: string;
  findContent: string;
  replaceContent: string;
  /** Confidence 0..1 that this edit is correct. */
  confidence: number;
  /** Symbol name being changed (for traceability) */
  symbol: string;
}

export interface RefactorPlan {
  /** The original request (e.g. "rename getUserByName to findUser") */
  request: string;
  /** Blasted radius analysis (what's affected) */
  blast: BlastRadiusResult;
  /** Multi-file patch (what to change) */
  edits: RefactorEdit[];
  /** Files NOT in the patch but still in the blast radius (explanation) */
  skippedFiles: Array<{ file: string; reason: string }>;
  /** Risk assessment */
  risk: "low" | "medium" | "high";
  warnings: string[];
  totalEdits: number;
  estimatedFilesChanged: number;
  durationMs: number;
}

// ─── Code graph client (Dim 4.2 — blast radius) ──────────────
/**
 * Try to use VibeServe's `codegraph_impact` tool for structural blast-radius
 * analysis. Returns null if the graph isn't built (or the call fails) so the
 * caller can fall back to the pure-Node walker.
 */
async function tryCodeGraphImpact(
  repoPath: string,
  target: string,
  direction: "upstream" | "downstream",
): Promise<BlastRadiusResult | null> {
  if (!VIBESERVE_URL) return null;
  const repoKey = repoPath.replace(/[\\/]/g, "/");
  try {
    const res = await fetch(`${VIBESERVE_URL}/tools/codegraph_impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify({ target, direction, repo_key: repoKey, max_depth: 3 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    if (body?.status !== "ok" || !body.impact) return null;

    // Map the VibeServe result to our BlastRadiusResult shape.
    // VibeServe returns levels: WILL_BREAK, LIKELY_AFFECTED, MIGHT_AFFECT.
    const impact = body.impact;
    const fileSet = new Set<string>();
    const byFileMap = new Map<string, { symbols: string[]; depth: number }>();
    const levels: Array<{ key: string; depth: number }> = [
      { key: "will_break", depth: 1 },
      { key: "likely_affected", depth: 2 },
      { key: "might_affect", depth: 3 },
    ];
    for (const { key, depth } of levels) {
      const list = impact[key] || [];
      for (const item of list) {
        const file = item.file || item.source_file;
        if (!file) continue;
        fileSet.add(file);
        const slot = byFileMap.get(file) || { symbols: [], depth };
        slot.symbols.push(item.symbol || item.name || target);
        slot.depth = Math.min(slot.depth, depth);
        byFileMap.set(file, slot);
      }
    }
    const byFile = Array.from(byFileMap.entries()).map(([file, v]) => ({ file, ...v }));
    const totalAffected = byFile.reduce((s, f) => s + f.symbols.length, 0);
    return {
      target,
      total_affected: totalAffected,
      max_depth: 3,
      by_file: byFile,
      files_to_edit: Array.from(fileSet),
      symbols_to_rename: [target],
      // code graph results are inherently structural — no test/prod split
    };
  } catch {
    return null;
  }
}

async function getBlastRadius(repoPath: string, target: string, direction: "upstream" | "downstream" = "upstream"): Promise<BlastRadiusResult> {
  const dir = resolve(repoPath);
  if (!existsSync(dir) || !target) {
    return {
      target, total_affected: 0, max_depth: 0, by_file: [],
      files_to_edit: [], symbols_to_rename: [],
    };
  }

  // Try the structured code graph first (VibeServe codegraph_impact).
  // Falls back to the regex-based walker if the graph isn't built.
  const graphResult = await tryCodeGraphImpact(repoPath, target, direction);
  if (graphResult && graphResult.total_affected > 0) {
    return graphResult;
  }

  // Pure-Node file walker (cross-platform, no grep/findstr quirks).
  // Used as a fallback when the code graph isn't available.
  const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb"]);
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "target", "vendor"]);
  // Test files don't usually need renaming — they're consumers of the public
  // API. Including them inflates blast radius and confuses risk scoring.
  const TEST_FILE_RE = /(^|[\/\\])(__tests__|tests|test|spec|specs)[\/\\]/i;
  const TEST_FILE_RE_EXT = /\.(test|spec)\.[a-z]+$/i;

  const allFiles: string[] = [];
  (function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d) as string[]; } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (SOURCE_EXTS.has(extname(full))) allFiles.push(full);
    }
  })(dir);

  const targetRe = new RegExp(`\\b${escapeRegex(target)}\\b`);
  // Definition patterns: capture the line that *defines* the symbol
  const defRe = new RegExp(`\\b(function|class|const|let|var|def|interface|type|export)\\s+${escapeRegex(target)}\\b`);

  const byFile = new Map<string, { matches: string[]; hasDefinition: boolean }>();
  for (const file of allFiles) {
    let content: string;
    try { content = readFileSync(file, "utf-8"); } catch { continue; }
    const lines = content.split("\n");
    let hasDef = false;
    const matched: string[] = [];
    for (const line of lines) {
      if (targetRe.test(line)) {
        matched.push(line.trim());
        if (defRe.test(line)) hasDef = true;
      }
    }
    if (matched.length > 0) byFile.set(file, { matches: matched, hasDefinition: hasDef });
  }

  if (process.env.MUTLY_DEBUG) {
    console.error(`[debug] walked ${allFiles.length} files, found ${byFile.size} with matches`);
  }

  const fileEntries = Array.from(byFile.entries())
    .map(([file, { matches, hasDefinition }]) => ({
      file: file.startsWith(dir) ? file.slice(dir.length).replace(/^[\\/]/, "").replace(/\\/g, "/") : file,
      symbols: matches,
      depth: hasDefinition ? 1 : 2,  // 1 = defines symbol, 2 = uses it
    }));

  // Include ALL files that reference the target in `files_to_edit` (including
  // the defining file). The LLM will propose the rename of the definition
  // plus the call-site updates. We do NOT exclude the defining file because
  // the actual rename edit needs to happen there.
  const allFilesToEdit = fileEntries.map((e) => e.file);

  // Tests count toward "total_affected" (so risk scoring is honest) but
  // are tracked separately since they're consumers, not producers.
  const testFilesToEdit = allFilesToEdit.filter(
    (f) => TEST_FILE_RE.test(f) || TEST_FILE_RE_EXT.test(f),
  );
  const productionFilesToEdit = allFilesToEdit.filter(
    (f) => !TEST_FILE_RE.test(f) && !TEST_FILE_RE_EXT.test(f),
  );

  const totalAffected = Array.from(byFile.values()).reduce((sum, s) => sum + s.matches.length, 0);

  if (process.env.MUTLY_DEBUG) {
    console.error(`[debug] blast: ${totalAffected} refs / ${allFilesToEdit.length} files (${productionFilesToEdit.length} prod, ${testFilesToEdit.length} test)`);
  }

  return {
    target,
    total_affected: totalAffected,
    max_depth: 2,
    by_file: fileEntries,
    // All files (including the defining file) — the LLM proposes the rename
    // of the definition plus the call-site updates.
    files_to_edit: productionFilesToEdit,
    symbols_to_rename: [target],
    // Surface test-file list so callers can warn the user
    test_files: testFilesToEdit,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── LLM client (Dim 4.3 — coordinated multi-file edit proposal) ─────────
async function proposeEdits(
  request: string,
  blast: BlastRadiusResult,
  repoPath: string,
  target: string,
): Promise<RefactorEdit[]> {
  // Read the target file content for context
  const targetFile = blast.by_file[0]?.file;
  let targetContent = "";
  if (targetFile) {
    try {
      targetContent = readFileSync(join(repoPath, targetFile), "utf-8").slice(0, 4000);
    } catch { /* ignore */ }
  }

  // Read the affected files
  const affectedContent: Record<string, string> = {};
  for (const f of blast.files_to_edit.slice(0, 10)) {
    try {
      const full = readFileSync(join(repoPath, f), "utf-8");
      // For large files, extract the lines around any match of the target
      // symbol so the LLM has the actual context, not just the first 3K chars.
      const lines = full.split("\n");
      const targetIdx: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(`\\b${escapeRegex(target)}\\b`).test(lines[i])) targetIdx.push(i);
      }
      if (targetIdx.length > 0) {
        // Take 50 lines before and 30 after each match.
        // IMPORTANT: return verbatim file content (no line-number prefix) so
        // the LLM's find/replace blocks are exact substrings of the real file.
        const seen = new Set<number>();
        const contextLines: string[] = [];
        for (const idx of targetIdx) {
          for (let i = Math.max(0, idx - 50); i < Math.min(lines.length, idx + 30); i++) {
            if (seen.has(i)) continue;
            seen.add(i);
            contextLines.push(lines[i]);
          }
        }
        affectedContent[f] = contextLines.join("\n").slice(0, 6000);
      } else {
        // No match in the file (shouldn't happen, but be defensive)
        affectedContent[f] = full.slice(0, 3000);
      }
    } catch (e) {
      if (process.env.MUTLY_DEBUG) console.error(`[debug] read error for ${f}: ${(e as Error).message}`);
    }
  }

  const prompt = `You are a senior engineer doing a coordinated multi-file refactor.

Request: ${request}
Blast radius: ${blast.total_affected} references across ${blast.files_to_edit.length} file(s)

Affected files:
${Object.entries(affectedContent).map(([f, c]) => `\n--- ${f} ---\n${c}`).join("\n")}

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
- Every "find" string MUST be a verbatim substring of the file (no edits, no paraphrasing)
- "replace" must be the exact new text
- Prefer the smallest possible find/replace blocks (not whole-file rewrites)
- Skip any edit where you're not confident (confidence < 0.6 → omit)
- If the refactor is unclear, return {"edits": []}

Return strict JSON only. No prose, no markdown.`;

  const res = await fetch(`${VIBESERVE_URL}/v1/llm/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify({ prompt, response_format: "json", temperature: 0.1 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    throw new Error(`LLM call failed: ${res.status}`);
  }
  const body = (await res.json()) as any;
  if (body.status !== "success") {
    throw new Error(`LLM error: ${body.error}`);
  }

  if (process.env.MUTLY_DEBUG) {
    console.error(`[debug] LLM content: ${body.content?.slice(0, 400)}`);
    console.error(`[debug] SENT prompt first 1500 chars: ${prompt.slice(0, 1500)}`);
    console.error(`[debug] affectedContent keys: ${Object.keys(affectedContent).join(",")}`);
    console.error(`[debug] server.ts has realJobAdapter? ${(affectedContent["server.ts"] || "").includes("realJobAdapter")}`);
  }

  // Parse response (handle prose, fences, or direct JSON)
  let parsed: any = null;
  try { parsed = JSON.parse(body.content); } catch {
    const m = body.content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }
  if (!parsed || !Array.isArray(parsed.edits)) return [];

  return parsed.edits
    .filter((e: any) => e && e.file && typeof e.find === "string" && typeof e.replace === "string")
    .map((e: any) => ({
      filePath: e.file,
      findContent: e.find,
      replaceContent: e.replace,
      confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
      symbol: typeof e.symbol === "string" ? e.symbol : blast.target,
    }));
}

// ─── Validation ──────────────────────────────────────────────
function validateEdits(edits: RefactorEdit[], repoPath: string): { valid: RefactorEdit[]; skipped: Array<{ file: string; reason: string }>; warnings: string[] } {
  const valid: RefactorEdit[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const warnings: string[] = [];

  // Skip lock files and binaries
  const SKIP_FILES = /\.(lock|log|min\.js|bundle\.js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|mp[34]|zip|tar|gz|wasm)$/i;
  const SKIP_PATHS = /(^|[\/\\])(node_modules|\.git|dist|build|coverage|\.next|target)[\/\\]/;

  for (const edit of edits) {
    if (SKIP_PATHS.test(edit.filePath)) {
      skipped.push({ file: edit.filePath, reason: "Generated/path-skipped" });
      continue;
    }
    if (SKIP_FILES.test(edit.filePath)) {
      skipped.push({ file: edit.filePath, reason: "Binary/lockfile" });
      continue;
    }
    if (!edit.findContent.trim()) {
      skipped.push({ file: edit.filePath, reason: "Empty find block" });
      continue;
    }
    if (edit.findContent === edit.replaceContent) {
      skipped.push({ file: edit.filePath, reason: "No-op edit (find == replace)" });
      continue;
    }
    if (edit.findContent.length > 10000) {
      warnings.push(`Large find block in ${edit.filePath} (${edit.findContent.length} chars) — review carefully`);
    }
    // Verify find block actually exists in the file
    try {
      const fileContent = readFileSync(join(repoPath, edit.filePath), "utf-8");
      if (!fileContent.includes(edit.findContent)) {
        skipped.push({ file: edit.filePath, reason: "Find block not found in file (whitespace mismatch?)" });
        continue;
      }
    } catch (e) {
      skipped.push({ file: edit.filePath, reason: `Could not read file: ${(e as Error).message}` });
      continue;
    }
    valid.push(edit);
  }

  // De-dupe by (file, find)
  const seen = new Set<string>();
  const deduped: RefactorEdit[] = [];
  for (const e of valid) {
    const key = `${e.filePath}::${e.findContent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return { valid: deduped, skipped, warnings };
}

function assessRisk(blast: BlastRadiusResult, edits: RefactorEdit[]): "low" | "medium" | "high" {
  if (blast.total_affected > 50) return "high";
  if (blast.total_affected > 10 || edits.length > 10) return "medium";
  return "low";
}

// ─── Main orchestrator ───────────────────────────────────────
export async function runRefactor(repoPath: string, request: string): Promise<RefactorPlan> {
  const start = Date.now();
  const warnings: string[] = [];

  // 1. Extract target symbol from the request.  Heuristic: look for
  //    "rename <X> to <Y>" or "change <X>" patterns.
  const targetMatch = request.match(/(?:rename|change|update|refactor)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i)
    || request.match(/`([A-Za-z_$][\w$]*)`/);
  const target = targetMatch ? targetMatch[1] : "";

  // 2. Compute blast radius
  const blast = await getBlastRadius(repoPath, target);
  if (blast.total_affected === 0) {
    warnings.push(`Symbol "${target}" not found in repo. Check the spelling.`);
  }
  if (blast.test_files && blast.test_files.length > 0) {
    warnings.push(
      `${blast.test_files.length} test file(s) reference "${target}". ` +
      `Tests will be re-checked when re-run, but the refactor does not edit them.`,
    );
  }

  // 3. Propose edits via LLM
  let edits: RefactorEdit[] = [];
  if (blast.total_affected > 0) {
    try {
      edits = await proposeEdits(request, blast, repoPath, target);
    } catch (e) {
      warnings.push(`LLM edit proposal failed: ${(e as Error).message}`);
    }
  }

  if (process.env.MUTLY_DEBUG) {
    console.error(`[debug] Blast files: ${JSON.stringify(blast.files_to_edit)}`);
    console.error(`[debug] LLM proposed ${edits.length} edit(s)`);
    for (const e of edits) console.error(`[debug]   ${e.filePath}: "${e.findContent.slice(0, 60)}..."`);
  }

  // 4. Validate
  const { valid, skipped, warnings: vWarns } = validateEdits(edits, repoPath);
  warnings.push(...vWarns);

  // 5. Risk
  const risk = assessRisk(blast, valid);

  return {
    request,
    blast,
    edits: valid,
    skippedFiles: skipped,
    risk,
    warnings,
    totalEdits: valid.length,
    estimatedFilesChanged: new Set(valid.map((e) => e.filePath)).size,
    durationMs: Date.now() - start,
  };
}

// ─── CLI ─────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: tsx refactor-orchestrator.ts <repo-path> <request>");
    console.error('Example: tsx refactor-orchestrator.ts ./jobclaw "rename getUserByName to findUser"');
    process.exit(1);
  }
  const repoPath = resolve(args[0]);
  const request = args.slice(1).join(" ");

  console.log(`\n  Refactor orchestrator`);
  console.log(`  Repo:    ${repoPath}`);
  console.log(`  Request: ${request}\n`);

  const plan = await runRefactor(repoPath, request);

  console.log(`  Blast radius: ${plan.blast.total_affected} references across ${plan.blast.files_to_edit.length} file(s)`);
  console.log(`  Edits:        ${plan.totalEdits} (${plan.estimatedFilesChanged} files will change)`);
  console.log(`  Risk:         ${plan.risk.toUpperCase()}`);
  console.log(`  Duration:     ${plan.durationMs}ms\n`);

  if (plan.warnings.length > 0) {
    console.log(`  ⚠️  Warnings:`);
    for (const w of plan.warnings) console.log(`     ${w}`);
    console.log();
  }

  if (plan.edits.length === 0) {
    console.log(`  No edits proposed. Nothing to apply.`);
    process.exit(0);
  }

  // Print the patch in a unified-diff-ish format
  console.log(`  ── Proposed edits ──`);
  for (const e of plan.edits) {
    console.log(`\n  📝 ${e.filePath}  (${e.symbol}, conf=${(e.confidence * 100).toFixed(0)}%)`);
    const findPreview = e.findContent.split("\n").slice(0, 5).join("\n");
    const replacePreview = e.replaceContent.split("\n").slice(0, 5).join("\n");
    console.log(`     -  ${findPreview.slice(0, 100)}${e.findContent.length > 100 ? "..." : ""}`);
    console.log(`     +  ${replacePreview.slice(0, 100)}${e.replaceContent.length > 100 ? "..." : ""}`);
  }

  // Emit the JSON for the VS Code extension to consume
  const patchPath = resolve("./refactor-patch.json");
  const patch = {
    edits: plan.edits.map((e) => ({
      filePath: e.filePath,
      findContent: e.findContent,
      replaceContent: e.replaceContent,
    })),
  };
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(resolve("."), { recursive: true });
  writeFileSync(patchPath, JSON.stringify(patch, null, 2), "utf-8");
  console.log(`\n  Patch written to ${patchPath}`);
  console.log(`  Apply with VS Code command: mutly.applyMultiFile (load the file as args)\n`);
}

// Only run if invoked directly (not when imported).  We detect this by
// checking if the script's URL is the main module URL.
const isMain = (() => {
  try {
    if (typeof import.meta.url !== "string" || !process.argv[1]) return false;
    const scriptPath = process.argv[1].replace(/\\/g, "/");
    return import.meta.url.endsWith(scriptPath) || scriptPath.endsWith("refactor-orchestrator.ts");
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error("Orchestrator crashed:", err);
    process.exit(1);
  });
}
