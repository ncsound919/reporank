// LLM-augmented code review scanner.
//
// Replaces pure-regex analysis (in apps/cli/src/scan.ts) with a call to the
// VibeServe LLM endpoint. Returns structured findings that the harness can
// score against ground truth.
//
// Per AGENTS.md:
//  - No hardcoded URLs (read from env via ../llm.ts)
//  - No eval()
//  - Proper async error handling
//  - Files kept under 300 lines (this is the scanner; the chunker is separate)

import { llmComplete, LLMUnavailableError } from "./llm";
import { chunkSourceFile, type FileChunk } from "./chunker";
import { buildReviewPrompt, REACT_GUIDANCE, type PromptMode } from "./prompts";

export interface Finding {
  /** Stable category like "security", "quality", "performance", "maintainability" */
  category: string;
  /** Severity: critical | high | medium | low | info */
  severity: "critical" | "high" | "medium" | "low" | "info";
  /** 1-based line number, or 0 if not specific to a line */
  line: number;
  /** Stable type tag like "sql-injection", "any-type-abuse" — used for matching ground truth */
  type: string;
  /** Human description of the issue */
  description: string;
  /** Actionable fix recommendation */
  recommendation: string;
  /** Confidence 0..1, set by the model. Used by harness for tie-breaking. */
  confidence: number;
  /** Optional file path (added by verify.ts and similar orchestrators) */
  path?: string;
}

export interface ScanInput {
  /** Stable task id (for traceability in logs) */
  id: string;
  /** Source language (ts, py, go, js) */
  language: string;
  /** Full file content to review */
  code: string;
  /** Optional path/filename context */
  filePath?: string;
  /** Optional project context the model should respect */
  projectContext?: string;
}

export interface ScanResult {
  taskId: string;
  findings: Finding[];
  /** Wall-clock duration of the scan in ms */
  durationMs: number;
  /** Tokens used (estimated) */
  tokens: number;
  /** Whether the scan used the LLM or fell back to heuristics */
  mode: "llm" | "heuristic";
  /** Optional raw model response for debugging */
  rawModelOutput?: string;
  /** Any non-fatal errors encountered */
  warnings: string[];
}

const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_TEMPERATURE = 0.1;

export interface ScanOptions {
  /** Override model temperature (default 0.1 for stability) */
  temperature?: number;
  /** Approximate token budget per chunk — chunks above this are skipped */
  maxChunkTokens?: number;
  /** Override prompt mode (default: react) */
  promptMode?: PromptMode;
  /** If true, also include regex/heuristic findings (union) */
  includeHeuristics?: boolean;
}

/**
 * Run an LLM-augmented review on a single source file.
 *
 * The file is chunked if it exceeds the token budget; each chunk produces its
 * own set of findings which are merged. Returns ScanResult; never throws on
 * LLM failure — falls back to empty findings + warning.
 */
export async function llmScan(input: ScanInput, opts: ScanOptions = {}): Promise<ScanResult> {
  const start = Date.now();
  const maxChunkTokens = opts.maxChunkTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const promptMode = opts.promptMode ?? "react";

  const findings: Finding[] = [];
  const warnings: string[] = [];
  let mode: ScanResult["mode"] = "llm";
  let totalTokens = 0;
  let lastRaw: string | undefined;

  try {
    const chunks = chunkSourceFile(input.code, input.language, maxChunkTokens);

    for (const chunk of chunks) {
      const prompt = buildReviewPrompt({
        language: input.language,
        filePath: input.filePath,
        projectContext: input.projectContext,
        code: chunk.text,
        startLine: chunk.startLine,
        mode: promptMode,
      });

      let raw: string;
      try {
        const result = await llmComplete({ prompt, temperature, responseFormat: "json" });
        raw = result.content;
        totalTokens += result.usage.total_tokens;
        lastRaw = raw;
        if (process.env.MUTLY_DEBUG) {
          console.error(`[review] task=${input.id} chunk=${chunk.index} len=${prompt.length} raw=${raw.slice(0, 150)}`);
        }
      } catch (e) {
        const msg = e instanceof LLMUnavailableError ? e.message : (e as Error).message;
        warnings.push(`chunk ${chunk.index}: LLM call failed — ${msg}`);
        continue;
      }

      // Defensive: model output might be wrapped in code fences or have prose
      const parsed = extractJson(raw);
      if (!parsed) {
        warnings.push(`chunk ${chunk.index}: could not parse JSON from LLM output`);
        continue;
      }

      const chunkFindings = normalizeFindings(parsed, chunk.startLine);
      findings.push(...chunkFindings);
    }
  } catch (e) {
    warnings.push(`scanner error: ${(e as Error).message}`);
    mode = "heuristic";
  }

  return {
    taskId: input.id,
    findings,
    durationMs: Date.now() - start,
    tokens: totalTokens,
    mode,
    rawModelOutput: lastRaw,
    warnings,
  };
}

/**
 * Extract a JSON object from an LLM response. Handles:
 *  - Pure JSON
 *  - JSON wrapped in ```json ... ``` fences
 *  - JSON embedded in prose (first {...} to matching })
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Try as-is
  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  // 2. Strip ```json ... ``` fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }

  // 3. Find the first balanced JSON object
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Normalize a parsed model response into Finding[]. Adjusts line numbers to
 * account for the chunk's starting line.
 */
export function normalizeFindings(parsed: unknown, chunkStartLine: number): Finding[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const raw = obj.findings ?? obj.issues ?? obj.problems;
  if (!Array.isArray(raw)) return [];

  const out: Finding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const line = typeof rec.line === "number" && rec.line > 0
      ? rec.line + chunkStartLine - 1
      : 0;

    const severity = normalizeSeverity(rec.severity);
    const category = typeof rec.category === "string" ? rec.category : "quality";
    const type = typeof rec.type === "string" && rec.type
      ? rec.type
      : slugify(category + " " + (rec.description || ""));
    const description = typeof rec.description === "string" ? rec.description : "";
    const recommendation = typeof rec.recommendation === "string" ? rec.recommendation : "";
    const confidence = typeof rec.confidence === "number"
      ? Math.max(0, Math.min(1, rec.confidence))
      : 0.7;

    if (!description) continue;
    out.push({ category, severity, line, type, description, recommendation, confidence });
  }
  return out;
}

function normalizeSeverity(v: unknown): Finding["severity"] {
  if (typeof v !== "string") return "medium";
  const s = v.toLowerCase();
  if (s === "critical" || s === "crit" || s === "blocker") return "critical";
  if (s === "high" || s === "error") return "high";
  if (s === "medium" || s === "moderate" || s === "warn" || s === "warning") return "medium";
  if (s === "low" || s === "minor") return "low";
  if (s === "info" || s === "informational" || s === "note") return "info";
  return "medium";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
