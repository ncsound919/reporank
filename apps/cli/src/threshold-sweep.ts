#!/usr/bin/env node
// Confidence threshold sweep — finds the optimal min-confidence for the heuristic
// scanner. Reports P/R/F1 at each threshold so you can pick the operating point.
//
// Usage: tsx threshold-sweep.ts [--llm]

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { heuristicScan } from "./heuristic_scanner";
import { runHarness } from "./harness";
import type { ReviewTask } from "./harness";
import type { Finding } from "./review_scanner";

const __filename = new URL(import.meta.url).pathname.replace(/^\//, "").replace(/%20/g, " ");
const __dirname = resolve(__filename, "..");
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

async function main() {
  const args = process.argv.slice(2);
  const useLlm = args.includes("--llm");

  if (!existsSync(DEFAULT_DATASET)) {
    console.error(`Dataset not found: ${DEFAULT_DATASET}`);
    process.exit(1);
  }
  const tasks: ReviewTask[] = JSON.parse(readFileSync(DEFAULT_DATASET, "utf-8"));
  console.log(`Sweeping thresholds over ${tasks.length} tasks (${useLlm ? "heuristic + LLM" : "heuristic-only"})\n`);

  // If --llm, pre-compute LLM findings once (they don't change with threshold)
  const llmCache: Map<string, Finding[]> = new Map();
  if (useLlm) {
    const { llmScan } = await import("./review_scanner");
    console.log("Computing LLM findings (this may take a moment)...");
    for (const task of tasks) {
      const scan = await llmScan({ id: task.id, language: task.language, code: task.code });
      llmCache.set(task.id, scan.findings);
    }
    console.log("Done. Sweeping...\n");
  }

  const thresholds = [0.0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
  const points: SweepPoint[] = [];

  for (const t of thresholds) {
    let tp = 0, fp = 0, fn = 0;
    for (const task of tasks) {
      const all: Finding[] = [];
      const heur = heuristicScan(task.code).filter((f) => f.confidence >= t);
      all.push(...heur);
      if (useLlm) {
        const llm = (llmCache.get(task.id) || []).filter((f) => f.confidence >= t);
        all.push(...llm);
      }
      // Dedupe by (type, line)
      const seen = new Map<string, Finding>();
      for (const f of all) {
        const key = `${f.type}@${f.line}`;
        const existing = seen.get(key);
        if (!existing || f.confidence > existing.confidence) seen.set(key, f);
      }
      const matched = matchTask(task, [...seen.values()]);
      tp += matched.tp;
      fp += matched.fp;
      fn += matched.fn;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    points.push({ threshold: t, tp, fp, fn, precision, recall, f1 });
  }

  console.log("Threshold   TP    FP    FN   Precision   Recall    F1");
  console.log("─".repeat(58));
  let best: SweepPoint = points[0];
  for (const p of points) {
    if (p.f1 > best.f1) best = p;
    console.log(
      `  ${p.threshold.toFixed(2)}      ${String(p.tp).padStart(4)} ${String(p.fp).padStart(5)} ${String(p.fn).padStart(5)}   ` +
      `${(p.precision * 100).toFixed(1).padStart(5)}%     ${(p.recall * 100).toFixed(1).padStart(5)}%   ${(p.f1 * 100).toFixed(1).padStart(5)}%` +
      (p === best ? "  ← best F1" : ""),
    );
  }
  console.log("\nBest operating point: threshold=" + best.threshold + " F1=" + (best.f1 * 100).toFixed(1) + "%");
  console.log("For 70% F1 target with current heuristics, we need LLM augmentation to fill the gap.");
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
      const typeMatch = predType === truthType || predType.includes(truthType.split("-")[0]);
      const lineMatch = truth[t].line > 0 && findings[p].line > 0 && Math.abs(findings[p].line - truth[t].line) <= 2;
      if (typeMatch && (lineMatch || truth[t].line === 0)) {
        usedPred.add(p);
        usedTruth.add(t);
        tp++;
        break;
      }
    }
  }
  return { tp, fp: findings.length - usedPred.size, fn: truth.length - usedTruth.size };
}

main().catch((err) => {
  console.error("Sweep crashed:", err);
  process.exit(1);
});
