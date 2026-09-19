import type { Command } from "commander";
import { resolve } from "node:path";
import {
  analyzeLoadedRepo,
  analyzePortfolio,
  budgetExitCode,
  buildCrossRepoReport,
  diffSnapshots,
  discoverRepos,
  evaluateBudget,
  loadHistory,
  loadRepo,
  parseDimensionBudgets,
  scanRepoHistory,
  unknownBudgetDimensions,
  type CrossRepoInput,
} from "@reporank/grading-engine";
import {
  renderBudget,
  renderCrossRepo,
  renderHistory,
  renderPortfolioRanking,
  renderScanResult,
} from "../portfolio-format.js";

interface TargetOptions {
  root?: string;
  json?: boolean;
}

interface RankOptions extends TargetOptions {
  minCohort?: string;
}

interface CrossRepoOptions extends TargetOptions {
  minSimilarity?: string;
}

interface ScanOptions {
  changedSince?: string;
  json?: boolean;
  full?: boolean;
}

interface HistoryOptions {
  json?: boolean;
}

interface BudgetOptions {
  maxIndex?: string;
  maxDimension?: string[];
  json?: boolean;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Resolve the CLI targets: explicit paths, plus --root, defaulting to cwd. */
export function resolveTargets(paths: string[], root?: string): string[] {
  const targets = [...paths];
  if (root) targets.push(root);
  return targets.length > 0 ? targets : [process.cwd()];
}

/** Discover repos under the targets and load each into a cross-repo input. */
function loadCrossRepoInputs(paths: string[], root?: string): CrossRepoInput[] {
  const roots = new Set<string>();
  for (const target of resolveTargets(paths, root)) {
    for (const repo of discoverRepos(resolve(target))) roots.add(resolve(repo));
  }
  return [...roots].sort().map((repoRoot) => {
    const loaded = loadRepo(repoRoot);
    return {
      name: loaded.name,
      ...(loaded.packageName ? { packageName: loaded.packageName } : {}),
      sourceFiles: loaded.sourceFiles,
    };
  });
}

export function registerPortfolioCommand(program: Command): void {
  const portfolio = program
    .command("portfolio")
    .description("Rank, benchmark, and compare multiple local repos (deterministic, no infra)");

  portfolio
    .command("rank")
    .description("Rank repos by deterministic risk x ROI")
    .argument("[paths...]", "Root directories or explicit repo paths (default: cwd)")
    .option("--root <dir>", "Root directory to discover repos in")
    .option("--min-cohort <n>", "Minimum cohort size before widening the benchmark", "3")
    .option("--json", "Output JSON")
    .action((paths: string[], opts: RankOptions) => {
      const report = analyzePortfolio(resolveTargets(paths, opts.root), {
        minCohortSize: Number(opts.minCohort ?? 3),
      });
      process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderPortfolioRanking(report));
    });

  portfolio
    .command("cross-repo")
    .description("Build a cross-repo import graph and detect duplicated implementations")
    .argument("[paths...]", "Root directories or explicit repo paths (default: cwd)")
    .option("--root <dir>", "Root directory to discover repos in")
    .option("--min-similarity <n>", "Jaccard similarity threshold for duplicates", "0.8")
    .option("--json", "Output JSON")
    .action((paths: string[], opts: CrossRepoOptions) => {
      const report = buildCrossRepoReport(loadCrossRepoInputs(paths, opts.root), {
        minSimilarity: Number(opts.minSimilarity ?? 0.8),
      });
      process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderCrossRepo(report));
    });

  portfolio
    .command("scan")
    .description("Analyze one repo, persist an index snapshot, and report drift + incremental cursor")
    .argument("<repo>", "Local repo path")
    .option("--changed-since <ref>", "Re-analyze only files changed since this git ref")
    .option("--full", "Force a full scan regardless of the cursor")
    .option("--json", "Output JSON")
    .action(async (repo: string, opts: ScanOptions) => {
      const root = resolve(repo);
      const { gitDelta } = await import("../bulk-scanner.js");
      const git = gitDelta(root, opts.changedSince);
      const result = scanRepoHistory(root, {
        changedSince: opts.changedSince ?? null,
        git,
        forceFull: !!opts.full,
      });
      process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderScanResult(result));
    });

  portfolio
    .command("history")
    .description("Show the persisted index snapshots for a repo")
    .argument("<repo>", "Local repo path")
    .option("--json", "Output JSON")
    .action((repo: string, opts: HistoryOptions) => {
      const store = loadHistory(resolve(repo));
      process.stdout.write(opts.json ? `${JSON.stringify(store, null, 2)}\n` : renderHistory(store));
    });

  portfolio
    .command("drift")
    .description("Show drift alerts between the last two persisted snapshots")
    .argument("<repo>", "Local repo path")
    .option("--json", "Output JSON")
    .action((repo: string, opts: HistoryOptions) => {
      const store = loadHistory(resolve(repo));
      const snapshots = store.snapshots;
      const alerts =
        snapshots.length >= 2 ? diffSnapshots(snapshots[snapshots.length - 2], snapshots[snapshots.length - 1]) : [];
      const output = { repo: store.repo, alerts, snapshots: snapshots.length };
      process.stdout.write(opts.json ? `${JSON.stringify(output, null, 2)}\n` : `${JSON.stringify(output)}\n`);
    });

  portfolio
    .command("budget")
    .description("Compute the structural index and exit non-zero when a score is below its budget (CI gate)")
    .argument("<repo>", "Local repo path")
    .option("--max-index <n>", "Minimum acceptable index, 0-100")
    .option(
      "--max-dimension <name=score>",
      "Minimum acceptable score for a dimension (repeatable, e.g. security=70)",
      collectOption,
      [],
    )
    .option("--json", "Output JSON")
    .action((repo: string, opts: BudgetOptions) => {
      const root = resolve(repo);
      const loaded = loadRepo(root);
      const { index } = analyzeLoadedRepo(loaded);

      let minIndex: number | undefined;
      if (opts.maxIndex !== undefined) {
        minIndex = Number(opts.maxIndex);
        if (!Number.isFinite(minIndex) || minIndex < 0 || minIndex > 100) {
          process.stderr.write(`  Error: --max-index must be a number 0..100 (got '${opts.maxIndex}')\n`);
          process.exitCode = 2;
          return;
        }
      }

      const parsed = parseDimensionBudgets(opts.maxDimension ?? []);
      if (parsed.error) {
        process.stderr.write(`  Error: ${parsed.error}\n`);
        process.exitCode = 2;
        return;
      }

      const unknown = unknownBudgetDimensions(index, parsed.budgets);
      if (unknown.length > 0) {
        process.stderr.write(`  Error: unknown or unmeasured dimension(s): ${unknown.join(", ")}\n`);
        process.exitCode = 2;
        return;
      }

      const report = evaluateBudget(index, {
        ...(minIndex !== undefined ? { minIndex } : {}),
        minDimensions: parsed.budgets,
        repo: loaded.name,
      });
      process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderBudget(report));
      process.exitCode = budgetExitCode(report);
    });
}
