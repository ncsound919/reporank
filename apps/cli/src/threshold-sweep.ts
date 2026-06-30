#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { heuristicScan } from "./heuristic_scanner";
import type { ReviewTask } from "./harness";
import type { Finding } from "./review_scanner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DATASET = resolve(__dirname, "../../../benchmarks/code_review/tasks.json");

interface SweepPoint {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

const THRESHOLDS = [0.0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useLlm = args.includes("--llm");

  if (!existsSync(DEFAULT_DATASET)) {
    throw new Error(`Dataset not found: ${DEFAULT_DATASET}`);
  }

  const tasks = loadTasks(DEFAULT_DATASET);
  process.stdout.write(
    `Sweeping thresholds over ${tasks.length} tasks (${useLlm ? "heuristic + LLM" : "heuristic-only"})\n`,
  );

  const llmCache = useLlm ? await buildLlmCache(tasks) : new Map<string, Finding[]>();
  const points = sweepThresholds(tasks, llmCache, useLlm);
  const best = selectBestPoint(points);

  printTable(points, best);
  process.stdout.write(
    `\nBest operating point: threshold=${best.threshold.toFixed(2)} F1=${(best.f1 * 100).toFixed(1)}%\n`,
  );
  process.stdout.write(
    "For 70% F1 target with current heuristics, we need LLM augmentation to fill the gap.\n",
  );
}

function loadTasks(datasetPath: string): ReviewTask[] {
  const raw = JSON.parse(readFileSync(datasetPath, "utf-8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Dataset must be a JSON array of review tasks.");
  }
  return raw as ReviewTask[];
}

async function buildLlmCache(tasks: ReviewTask[]): Promise<Map<string, Finding[]>> {
  const { llmScan } = await import("./review_scanner");
  const cache = new Map<string, Finding[]>();

  process.stdout.write("Computing LLM findings (this may take a moment)...\n");
  for (const task of tasks) {
    const scan = await llmScan({
      id: task.id,
      language: task.language,
      code: task.code,
    });
    cache.set(task.id, scan.findings);
  }
  process.stdout.write("Done. Sweeping...\n");

  return cache;
}

function sweepThresholds(
  tasks: ReviewTask[],
  llmCache: Map<string, Finding[]>,
  useLlm: boolean,
): SweepPoint[] {
  const points: SweepPoint[] = [];

  for (const threshold of THRESHOLDS) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (const task of tasks) {
      const merged: Finding[] = [];
      merged.push(...heuristicScan(task.code).filter((finding) => finding.confidence >= threshold));

      if (useLlm) {
        merged.push(
          ...(llmCache.get(task.id) ?? []).filter((finding) => finding.confidence >= threshold),
        );
      }

      const deduped = dedupeFindings(merged);
      const matched = matchTask(task, deduped);

      tp += matched.tp;
      fp += matched.fp;
      fn += matched.fn;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    points.push({ threshold, tp, fp, fn, precision, recall, f1 });
  }

  return points;
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();

  for (const finding of findings) {
    const key = `${finding.type}@${finding.line}`;
    const existing = seen.get(key);

    if (!existing || finding.confidence > existing.confidence) {
      seen.set(key, finding);
    }
  }

  return [...seen.values()];
}

function selectBestPoint(points: SweepPoint[]): SweepPoint {
  let best = points[0];

  for (const point of points) {
    if (
      point.f1 > best.f1 ||
      (point.f1 === best.f1 && point.precision > best.precision) ||
      (point.f1 === best.f1 &&
        point.precision === best.precision &&
        point.threshold > best.threshold)
    ) {
      best = point;
    }
  }

  return best;
}

function printTable(points: SweepPoint[], best: SweepPoint): void {
  process.stdout.write("\n");
  process.stdout.write("Threshold   TP    FP    FN   Precision   Recall    F1\n");
  process.stdout.write(`${"─".repeat(58)}\n`);

  for (const point of points) {
    const marker = point.threshold === best.threshold && point.f1 === best.f1 ? "  ← best F1" : "";
    process.stdout.write(
      `  ${point.threshold.toFixed(2)}      ${String(point.tp).padStart(4)} ${String(point.fp).padStart(5)} ${String(point.fn).padStart(5)}   ` +
        `${(point.precision * 100).toFixed(1).padStart(5)}%     ${(point.recall * 100).toFixed(1).padStart(5)}%   ${(point.f1 * 100).toFixed(1).padStart(5)}%` +
        `${marker}\n`,
    );
  }
}

function matchTask(task: ReviewTask, findings: Finding[]): { tp: number; fp: number; fn: number } {
  const truth = task.ground_truth;
  const usedPred = new Set<number>();
  const usedTruth = new Set<number>();
  let tp = 0;

  for (let t = 0; t < truth.length; t++) {
    for (let p = 0; p < findings.length; p++) {
      if (usedPred.has(p)) continue;

      const truthType = truth[t].type;
      const predType = findings[p].type;
      const typeMatch =
        predType === truthType || predType.includes(truthType.split("-")[0]);

      const lineMatch =
        truth[t].line > 0 &&
        findings[p].line > 0 &&
        Math.abs(findings[p].line - truth[t].line) <= 2;

      if (typeMatch && (lineMatch || truth[t].line === 0)) {
        usedPred.add(p);
        usedTruth.add(t);
        tp++;
        break;
      }
    }
  }

  return {
    tp,
    fp: findings.length - usedPred.size,
    fn: truth.length - usedTruth.size,
  };
}

main().catch((error) => {
  process.stderr.write(`Sweep crashed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
