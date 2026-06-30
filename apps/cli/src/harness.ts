#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { heuristicScan } from "./heuristic_scanner";
import { llmScan, type Finding, type ScanResult } from "./review_scanner";
import type { PromptMode } from "./prompts";
import { capFindings, dedupeFindings } from "./util/dedupe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DATASET = resolve(__dirname, "../../../benchmarks/code_review/tasks.json");

export interface GroundTruthFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  line: number;
  type: string;
  description: string;
}

export interface ReviewTask {
  id: string;
  category: string;
  severity: GroundTruthFinding["severity"];
  language: string;
  source: string;
  code: string;
  ground_truth: GroundTruthFinding[];
  expected_recommendation_keywords?: string[];
}

export interface MatchedPair {
  predicted: Finding;
  groundTruth: GroundTruthFinding;
  matchScore: number;
}

export interface TaskResult {
  id: string;
  groundTruthCount: number;
  predictedCount: number;
  truePositives: MatchedPair[];
  falsePositives: Finding[];
  falseNegatives: GroundTruthFinding[];
  durationMs: number;
  tokens: number;
  warnings: string[];
}

export interface HarnessReport {
  totalTasks: number;
  skippedTasks: number;
  aggregate: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1: number;
  };
  perTask: TaskResult[];
  byCategory: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  bySeverity: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  cost: {
    totalTokens: number;
    totalDurationMs: number;
    averageLatencyMs: number;
  };
  config: {
    promptMode: PromptMode;
    lineTolerance: number;
    typeMatchWeight: number;
    lineMatchWeight: number;
    descriptionSimilarityWeight: number;
  };
}

interface HarnessOptions {
  dataset?: string;
  output?: string;
  mode: PromptMode;
  lineTolerance: number;
  typeMatchWeight: number;
  lineMatchWeight: number;
  descriptionSimilarityWeight: number;
  concurrency: number;
  maxChunkTokens?: number;
  temperature?: number;
  filter?: string;
  heuristicOnly?: boolean;
  llmOnly?: boolean;
  minConfidence: number;
}

type Bucket = { tp: number; fp: number; fn: number };

function fail(message: string): never {
  throw new Error(message);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseCommanderArgs(args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const current = args[i];
    if (!current.startsWith("--")) continue;

    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

    if (inlineValue !== undefined) {
      const asNum = Number(inlineValue);
      out[key] = inlineValue.trim() !== "" && !Number.isNaN(asNum) ? asNum : inlineValue;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      const asNum = Number(next);
      out[key] = next.trim() !== "" && !Number.isNaN(asNum) ? asNum : next;
      i++;
    } else {
      out[key] = true;
    }
  }

  return out;
}

function parseArgs(args: Record<string, unknown> | string[]): HarnessOptions {
  const opts: HarnessOptions = {
    mode: "strict",
    lineTolerance: 2,
    typeMatchWeight: 0.6,
    lineMatchWeight: 0.3,
    descriptionSimilarityWeight: 0.1,
    concurrency: 2,
    minConfidence: 0,
  };

  const source = Array.isArray(args) ? parseCommanderArgs(args) : args;

  if (typeof source.dataset === "string") opts.dataset = resolve(source.dataset);
  if (typeof source.output === "string") opts.output = resolve(source.output);
  if (typeof source.mode === "string") opts.mode = source.mode as PromptMode;
  if (typeof source.filter === "string") opts.filter = source.filter;

  if (source.maxChunkTokens !== undefined) opts.maxChunkTokens = toFiniteNumber(source.maxChunkTokens, 0);
  if (source.temperature !== undefined) opts.temperature = toFiniteNumber(source.temperature, 0);
  opts.lineTolerance = Math.max(0, toFiniteNumber(source.lineTolerance, opts.lineTolerance));
  opts.concurrency = Math.max(1, Math.floor(toFiniteNumber(source.concurrency, opts.concurrency)));
  opts.minConfidence = clamp(toFiniteNumber(source.minConfidence, opts.minConfidence), 0, 1);

  if (source.heuristicOnly === true) opts.heuristicOnly = true;
  if (source.llmOnly === true) opts.llmOnly = true;
  if (opts.heuristicOnly && opts.llmOnly) fail("Options --heuristic-only and --llm-only cannot be used together.");

  return opts;
}

export async function runHarness(cliOpts: Record<string, unknown> = {}): Promise<void> {
  const opts = parseArgs(cliOpts);
  const datasetPath = opts.dataset ?? DEFAULT_DATASET;

  if (!existsSync(datasetPath)) fail(`Dataset not found: ${datasetPath}`);

  let tasks: ReviewTask[];
  try {
    const parsed = JSON.parse(readFileSync(datasetPath, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) fail("Dataset must be a JSON array.");
    tasks = parsed as ReviewTask[];
  } catch (error) {
    fail(`Failed to load dataset: ${(error as Error).message}`);
  }

  process.stdout.write(`Loaded ${tasks.length} tasks from ${datasetPath}\n`);
  process.stdout.write(
    `Config: mode=${opts.mode} lineTolerance=${opts.lineTolerance} concurrency=${opts.concurrency} minConfidence=${opts.minConfidence} heuristicOnly=${!!opts.heuristicOnly} llmOnly=${!!opts.llmOnly}\n`,
  );

  const queue = [...tasks];
  const resultMap = new Map<string, TaskResult>();
  let totalTokens = 0;
  let totalDurationMs = 0;

  await Promise.all(
    Array.from({ length: opts.concurrency }, async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) return;

        const result = await runTask(task, opts);
        resultMap.set(task.id, result);
        totalTokens += result.tokens;
        totalDurationMs += result.durationMs;

        process.stdout.write(
          `  ${result.id.padEnd(28)} TP=${result.truePositives.length} FP=${result.falsePositives.length} FN=${result.falseNegatives.length} (${result.durationMs}ms)\n`,
        );
      }
    }),
  );

  const orderedResults = tasks
    .map((task) => resultMap.get(task.id))
    .filter((result): result is TaskResult => Boolean(result));

  const report = scoreAll(orderedResults, opts);
  report.cost = {
    totalTokens,
    totalDurationMs,
    averageLatencyMs: totalDurationMs / Math.max(1, orderedResults.filter((r) => !r.warnings.includes("filtered")).length),
  };

  printReport(report);

  if (opts.output) {
    mkdirSync(dirname(opts.output), { recursive: true });
    writeFileSync(opts.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    process.stdout.write(`\nWrote report to ${opts.output}\n`);
  }
}

async function runTask(task: ReviewTask, opts: HarnessOptions): Promise<TaskResult> {
  if (opts.filter && !task.id.startsWith(opts.filter)) {
    return {
      id: task.id,
      groundTruthCount: task.ground_truth.length,
      predictedCount: 0,
      truePositives: [],
      falsePositives: [],
      falseNegatives: [...task.ground_truth],
      durationMs: 0,
      tokens: 0,
      warnings: ["filtered"],
    };
  }

  const findings: Finding[] = [];
  const warnings: string[] = [];
  let totalDuration = 0;
  let totalTokens = 0;

  try {
    if (!opts.llmOnly) {
      findings.push(...heuristicScan(task.code));
    }

    if (!opts.heuristicOnly) {
      const scan = await llmScan(
        { id: task.id, language: task.language, code: task.code, filePath: `task/${task.id}` },
        { promptMode: opts.mode, temperature: opts.temperature, maxChunkTokens: opts.maxChunkTokens },
      );

      findings.push(...scan.findings);
      warnings.push(...scan.warnings);
      totalDuration += scan.durationMs;
      totalTokens += scan.tokens;
    }
  } catch (error) {
    warnings.push(`scan-failed: ${(error as Error).message}`);
  }

  const filtered = findings.filter((finding) => (finding.confidence ?? 0) >= opts.minConfidence);

  const synthetic: ScanResult = {
    taskId: task.id,
    findings: capFindings(dedupeFindings(filtered)),
    durationMs: totalDuration,
    tokens: totalTokens,
    mode: opts.heuristicOnly ? "heuristic" : "llm",
    warnings,
  };

  return matchFindings(task, synthetic, opts);
}

function matchFindings(task: ReviewTask, scan: ScanResult, opts: HarnessOptions): TaskResult {
  const predictions = scan.findings;
  const truth = task.ground_truth;
  const usedPredictions = new Set<number>();
  const usedTruth = new Set<number>();
  const truePositives: MatchedPair[] = [];

  for (let t = 0; t < truth.length; t++) {
    let bestPredictionIndex = -1;
    let bestScore = 0;

    for (let p = 0; p < predictions.length; p++) {
      if (usedPredictions.has(p)) continue;
      const score = matchScore(truth[t], predictions[p], opts);
      if (score >= 0.5 && score > bestScore) {
        bestScore = score;
        bestPredictionIndex = p;
      }
    }

    if (bestPredictionIndex >= 0) {
      usedPredictions.add(bestPredictionIndex);
      usedTruth.add(t);
      truePositives.push({
        predicted: predictions[bestPredictionIndex],
        groundTruth: truth[t],
        matchScore: bestScore,
      });
    }
  }

  return {
    id: task.id,
    groundTruthCount: truth.length,
    predictedCount: predictions.length,
    truePositives,
    falsePositives: predictions.filter((_p, index) => !usedPredictions.has(index)),
    falseNegatives: truth.filter((_t, index) => !usedTruth.has(index)),
    durationMs: scan.durationMs,
    tokens: scan.tokens,
    warnings: scan.warnings,
  };
}

function matchScore(truth: GroundTruthFinding, pred: Finding, opts: HarnessOptions): number {
  let score = 0;

  if (pred.type && truth.type) {
    const predictedType = canonicalizeType(pred.type);
    const truthType = canonicalizeType(truth.type);

    if (predictedType === truthType) {
      score += opts.typeMatchWeight;
    } else if (prefixMatch(predictedType, truthType)) {
      score += opts.typeMatchWeight * 0.7;
    } else {
      const predictedWords = new Set(predictedType.split("-"));
      const truthWords = new Set(truthType.split("-"));
      const overlap = [...predictedWords].filter((word) => truthWords.has(word)).length;
      const minSize = Math.min(predictedWords.size, truthWords.size);

      if (minSize > 0 && overlap / minSize >= 0.5) {
        score += opts.typeMatchWeight * 0.4;
      } else {
        const firstPredicted = predictedWords.values().next().value as string | undefined;
        const firstTruth = truthWords.values().next().value as string | undefined;
        if ((firstPredicted && truthWords.has(firstPredicted)) || (firstTruth && predictedWords.has(firstTruth))) {
          score += opts.typeMatchWeight * 0.2;
        }
      }
    }
  }

  const predictedLine = typeof pred.line === "number" ? pred.line : 0;
  if (predictedLine > 0 && truth.line > 0) {
    const distance = Math.abs(predictedLine - truth.line);
    if (distance <= opts.lineTolerance) {
      score += opts.lineMatchWeight * (1 - distance / (opts.lineTolerance + 1));
    }
  } else if (predictedLine === 0 && truth.line === 0) {
    score += opts.lineMatchWeight;
  }

  const truthTokens = new Set(tokenize(truth.description));
  const predictedTokens = new Set(tokenize(pred.description));
  const intersection = [...truthTokens].filter((token) => predictedTokens.has(token)).length;
  const union = new Set([...truthTokens, ...predictedTokens]).size || 1;
  score += opts.descriptionSimilarityWeight * (intersection / union);

  return score;
}

function canonicalizeType(value: string): string {
  const suffixes = new Set(["vulnerability", "issue", "error", "warning", "bug", "smell", "pattern", "antipattern"]);
  const parts = value.toLowerCase().split("-").filter(Boolean);

  while (parts.length > 1 && suffixes.has(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts.join("-");
}

function prefixMatch(a: string, b: string): boolean {
  return a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function scoreAll(results: TaskResult[], opts: HarnessOptions): HarnessReport {
  const activeResults = results.filter((result) => !result.warnings.includes("filtered"));
  const byCategory = new Map<string, Bucket>();
  const bySeverity = new Map<string, Bucket>();
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const result of activeResults) {
    tp += result.truePositives.length;
    fp += result.falsePositives.length;
    fn += result.falseNegatives.length;

    for (const pair of result.truePositives) {
      bump(byCategory, pair.groundTruth.category || "unknown", "tp");
      bump(bySeverity, pair.groundTruth.severity || "unknown", "tp");
    }
    for (const finding of result.falsePositives) {
      bump(byCategory, finding.category || "unknown", "fp");
      bump(bySeverity, finding.severity || "unknown", "fp");
    }
    for (const finding of result.falseNegatives) {
      bump(byCategory, finding.category || "unknown", "fn");
      bump(bySeverity, finding.severity || "unknown", "fn");
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const bucketize = (bucket: Map<string, Bucket>) => {
    const out: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
    for (const [key, value] of bucket) {
      const p = value.tp + value.fp > 0 ? value.tp / (value.tp + value.fp) : 0;
      const r = value.tp + value.fn > 0 ? value.tp / (value.tp + value.fn) : 0;
      const score = p + r > 0 ? (2 * p * r) / (p + r) : 0;
      out[key] = { precision: p, recall: r, f1: score, support: value.tp + value.fn };
    }
    return out;
  };

  return {
    totalTasks: results.length,
    skippedTasks: results.filter((result) => result.warnings.includes("filtered")).length,
    aggregate: { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 },
    perTask: results,
    byCategory: bucketize(byCategory),
    bySeverity: bucketize(bySeverity),
    cost: { totalTokens: 0, totalDurationMs: 0, averageLatencyMs: 0 },
    config: {
      promptMode: opts.mode,
      lineTolerance: opts.lineTolerance,
      typeMatchWeight: opts.typeMatchWeight,
      lineMatchWeight: opts.lineMatchWeight,
      descriptionSimilarityWeight: opts.descriptionSimilarityWeight,
    },
  };
}

function bump(map: Map<string, Bucket>, key: string, field: keyof Bucket): void {
  const bucket = map.get(key) ?? { tp: 0, fp: 0, fn: 0 };
  bucket[field] += 1;
  map.set(key, bucket);
}

function printReport(report: HarnessReport): void {
  process.stdout.write(`\n${"═".repeat(72)}\n`);
  process.stdout.write("  REPORANK CODE REVIEW ACCURACY — HARNESS REPORT\n");
  process.stdout.write(`${"═".repeat(72)}\n`);
  process.stdout.write(`  Tasks:    ${report.totalTasks} (${report.skippedTasks} filtered)\n`);
  process.stdout.write(
    `  TP/FP/FN: ${report.aggregate.truePositives} / ${report.aggregate.falsePositives} / ${report.aggregate.falseNegatives}\n`,
  );
  process.stdout.write(`  Precision: ${(report.aggregate.precision * 100).toFixed(1)}%\n`);
  process.stdout.write(`  Recall:    ${(report.aggregate.recall * 100).toFixed(1)}%\n`);
  process.stdout.write(`  F1:        ${(report.aggregate.f1 * 100).toFixed(1)}%\n`);
  process.stdout.write(
    `  Cost:      ${report.cost.totalTokens} tokens, ${(report.cost.totalDurationMs / 1000).toFixed(1)}s total, ${report.cost.averageLatencyMs.toFixed(0)}ms avg/task\n`,
  );

  process.stdout.write("\n  By category:\n");
  for (const [key, value] of Object.entries(report.byCategory).sort((a, b) => b[1].support - a[1].support)) {
    process.stdout.write(
      `    ${key.padEnd(18)} P=${(value.precision * 100).toFixed(0).padStart(3)}% R=${(value.recall * 100).toFixed(0).padStart(3)}% F1=${(value.f1 * 100).toFixed(0).padStart(3)}% (n=${value.support})\n`,
    );
  }

  process.stdout.write("\n  By severity:\n");
  for (const [key, value] of Object.entries(report.bySeverity).sort((a, b) => b[1].support - a[1].support)) {
    process.stdout.write(
      `    ${key.padEnd(18)} P=${(value.precision * 100).toFixed(0).padStart(3)}% R=${(value.recall * 100).toFixed(0).padStart(3)}% F1=${(value.f1 * 100).toFixed(0).padStart(3)}% (n=${value.support})\n`,
    );
  }

  process.stdout.write(`${"═".repeat(72)}\n`);
}

const isDirectRun =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  runHarness(parseCommanderArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`Harness crashed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
