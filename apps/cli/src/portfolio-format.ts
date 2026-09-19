/**
 * portfolio-format.ts — pure text renderers for the `portfolio` commands.
 *
 * Kept free of runtime engine imports (types only) so it can be unit-tested
 * without building/resolving the grading-engine dist.
 */
import type {
  BudgetReport,
  CrossRepoReport,
  HistoryStore,
  PortfolioEntry,
  PortfolioReport,
  RepoScanResult,
} from "@reporank/grading-engine";

function benchLabel(entry: PortfolioEntry): string {
  const benchmark = entry.benchmark;
  if (!benchmark) return "n/a";
  const percentile = benchmark.percentile === null ? "?" : `${benchmark.percentile}%`;
  return `${percentile} (n=${benchmark.sampleSize}, ${benchmark.cohort})`;
}

function driverLines(entry: PortfolioEntry): string[] {
  return entry.drivers
    .slice(0, 3)
    .map((driver) => {
      const evidence = driver.findings[0];
      const location = evidence ? ` <- ${evidence.file}${evidence.line ? `:${evidence.line}` : ""}` : "";
      return `      - ${driver.dimension.padEnd(13)} penalty ${driver.penalty.toFixed(1).padStart(6)}  roi ${driver.roi
        .toFixed(1)
        .padStart(6)}${location}`;
    });
}

export function renderPortfolioRanking(report: PortfolioReport): string {
  const lines: string[] = [];
  lines.push(`Portfolio ranking — ${report.entries.length} repo(s) by risk x ROI`);
  lines.push("");
  report.entries.forEach((entry, index) => {
    lines.push(
      `  ${String(index + 1).padStart(2)}. ${entry.repo}  score=${entry.score}  risk=${entry.risk}  roi=${entry.roi}  ` +
        `index=${entry.index}  cohort=${entry.cohort}  benchmark=${benchLabel(entry)}`,
    );
    lines.push(...driverLines(entry));
  });
  if (report.entries.length === 0) lines.push("  (no repos found)");
  return `${lines.join("\n")}\n`;
}

export function renderCrossRepo(report: CrossRepoReport): string {
  const lines: string[] = [];
  lines.push(`Cross-repo analysis — ${report.repos.length} repo(s)`);
  lines.push("");
  lines.push(`  Dependency edges (${report.edges.length}):`);
  if (report.edges.length === 0) lines.push("    (none)");
  for (const edge of report.edges) {
    lines.push(`    ${edge.from} -> ${edge.to}  via "${edge.specifier}" (${edge.count} file(s))`);
  }
  lines.push("");
  lines.push(`  Duplicated implementations (${report.duplicates.length}):`);
  if (report.duplicates.length === 0) lines.push("    (none)");
  for (const duplicate of report.duplicates) {
    lines.push(
      `    ${duplicate.a.repo}:${duplicate.a.file}  <->  ${duplicate.b.repo}:${duplicate.b.file}  ` +
        `similarity=${duplicate.similarity} shared=${duplicate.sharedShingles}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderScanResult(result: RepoScanResult): string {
  const lines: string[] = [];
  const incremental = result.incremental;
  const mode = incremental.reusedFiles > 0 ? "changed" : "full";
  lines.push(`Scan — ${result.repo} (${result.path})`);
  lines.push(`  index: ${result.index}`);
  lines.push(
    `  incremental: mode=${mode}  changed=${incremental.changedFiles.length}  reused=${incremental.reusedFiles}  ` +
      `reusedFindings=${incremental.reusedFindings}  cacheHitRate=${(incremental.cacheHitRate * 100).toFixed(1)}%  ` +
      `commit=${incremental.cursor.lastCommit ?? "(none)"}`,
  );
  lines.push(`  history: ${result.historyPath}`);
  if (result.alerts.length === 0) {
    lines.push("  drift: none");
  } else {
    lines.push(`  drift alerts (${result.alerts.length}):`);
    for (const alert of result.alerts) {
      lines.push(
        `    [${alert.severity}] ${alert.dimension}: ${alert.previous} -> ${alert.current} (${alert.delta}, threshold ${alert.threshold})`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderHistory(store: HistoryStore): string {
  const lines: string[] = [];
  lines.push(`History — ${store.repo}`);
  lines.push(`  snapshots: ${store.snapshots.length}`);
  lines.push(
    `  cursor: commit=${store.cursor.lastCommit ?? "(none)"} scannedAt=${store.cursor.lastScannedAt ?? "(none)"}`,
  );
  for (const snapshot of store.snapshots.slice(-10)) {
    lines.push(
      `    ${snapshot.scannedAt}  commit=${snapshot.commit ?? "-"}  index=${snapshot.index}  normalized=${snapshot.normalizedIndex}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderBudget(report: BudgetReport): string {
  const lines: string[] = [];
  lines.push(`Budget — ${report.repo ?? "(repo)"}`);
  lines.push(`  index: ${report.index} (penalty ${report.penalty})`);

  const requested: string[] = [];
  if (report.budgets.minIndex !== null) requested.push(`minIndex>=${report.budgets.minIndex}`);
  for (const name of Object.keys(report.budgets.minDimensions).sort()) {
    requested.push(`${name}>=${report.budgets.minDimensions[name]}`);
  }
  lines.push(`  budgets: ${requested.length > 0 ? requested.join(", ") : "(none)"}`);
  lines.push(`  ${report.passed ? "PASS" : "FAIL"}`);

  for (const breach of report.breaches) {
    const label = breach.dimension ?? "index";
    lines.push(
      `  breach [${breach.kind}] ${label}: ${breach.actualScore} < ${breach.required} (penalty ${breach.actualPenalty})`,
    );
    for (const driver of breach.drivers.slice(0, 3)) {
      const location = `${driver.file}${driver.line !== undefined ? `:${driver.line}` : ""}`;
      lines.push(`    <- ${location} [${driver.severity}] ${driver.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
