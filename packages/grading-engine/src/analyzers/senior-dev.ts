/**
 * Senior Developer Analyzer — bus factor, risk heatmap, test gaps,
 * change coupling, and tech debt ratio analysis that goes beyond
 * surface-level metrics. Built for engineers who own production systems.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── 1. Bus Factor ─────────────────────────────────────────────────────
export interface BusFactorItem {
  file: string;
  owner: string;
  lastModified: string;
  risk: "critical" | "high" | "medium";
  rationale: string;
}

export function analyzeBusFactor(repoPath?: string): { items: BusFactorItem[]; score: number; summary: string } {
  const items: BusFactorItem[] = [];
  if (!repoPath || !existsSync(join(repoPath, ".git"))) {
    return { items, score: 100, summary: "Bus factor analysis requires a local git repository with .git directory." };
  }
  try {
    const { execSync } = require("node:child_process");
    // Get files with single author (high bus factor risk)
    const singleOwnerFiles = execSync(
      `git ls-files | xargs -I{} sh -c 'count=$(git log --format="%aE" -- "{}" | sort -u | wc -l); if [ "$count" -eq 1 ]; then echo "$(git log -1 --format="%aE|%aI" -- "{}")|{}"; fi'`,
      { cwd: repoPath, encoding: "utf-8", timeout: 30000 }
    ).trim().split("\n").filter(Boolean);

    let busScore = 100;
    for (const line of singleOwnerFiles.slice(0, 20)) {
      const parts = line.split("|");
      if (parts.length >= 3) {
        const [email, date, ...fileParts] = parts;
        const file = fileParts.join("|");
        // Only flag source files, not configs
        if (file.match(/\.(ts|tsx|js|jsx|py|go|rs|java)$/)) {
          const monthsOld = monthsSince(date);
          const risk = monthsOld > 6 ? "critical" : monthsOld > 3 ? "high" : "medium";
          items.push({ file, owner: email, lastModified: date, risk, rationale: `Single author (${email}), last modified ${monthsOld} months ago` });
          busScore -= risk === "critical" ? 5 : risk === "high" ? 3 : 1;
        }
      }
    }
    return { items, score: Math.max(0, busScore), summary: `${items.length} single-owner source files found. Bus factor is 1 for ${items.length} files.` };
  } catch {
    return { items, score: 100, summary: "Bus factor analysis failed — git may not be available." };
  }
}

// ─── 2. Risk Heatmap ──────────────────────────────────────────────────
export interface RiskItem {
  file: string;
  complexity: "low" | "medium" | "high";
  churn: number;
  riskScore: number;
  concern: string;
}

export function analyzeRiskHeatmap(sourceFiles: { path: string; content: string }[]): { items: RiskItem[]; maxRisk: number; summary: string } {
  // Estimate complexity from nesting depth, file size, and exports
  const items: RiskItem[] = [];

  for (const file of sourceFiles) {
    if (!file || !file.content) continue;
    const lines = file.content.split("\n");
    const lineCount = lines.length;

    // Complexity: count control flow keywords
    const controlFlow = (file.content.match(/\b(if|for|while|switch|catch|try)\s/g) || []).length;
    const functions = (file.content.match(/\bfunction\s+\w+/g) || []).length;
    const exports = (file.content.match(/\bexport\s+\w+/g) || []).length;
    const complexity = controlFlow > 30 ? "high" : controlFlow > 15 ? "medium" : "low";

    // Churn: file size is a rough proxy for change frequency in analysis-only mode
    const sizeFactor = Math.min(lineCount / 200, 3); // 0-3 multiplier
    const fnDensity = functions / Math.max(1, lineCount) * 100;
    const churn = Math.round(sizeFactor * 10 + fnDensity);

    // Risk = complexity weight × churn
    const complexityWeight = complexity === "high" ? 3 : complexity === "medium" ? 1.5 : 0.5;
    const riskScore = Math.round(complexityWeight * churn);

    if (riskScore > 15) {
      const concern = complexity === "high" && lineCount > 300
        ? `High complexity (${controlFlow} control paths) + large file (${lineCount} lines) — refactor or add tests`
        : complexity === "high"
        ? `High complexity (${controlFlow} control paths) — ${functions} functions`
        : `Moderate risk — ${lineCount} lines, ${functions} functions`;
      items.push({ file: file.path, complexity, churn, riskScore, concern });
    }
  }

  items.sort((a, b) => b.riskScore - a.riskScore);
  const maxRisk = items[0]?.riskScore || 0;
  return {
    items: items.slice(0, 15),
    maxRisk,
    summary: `${items.length} high-risk files identified. Top: ${items[0]?.file || "none"} (risk score: ${items[0]?.riskScore || 0}).`,
  };
}

// ─── 3. Test Gap Analysis ─────────────────────────────────────────────
export interface TestGap {
  sourceFile: string;
  hasTest: boolean;
  testFile?: string;
  complexity: string;
  priority: "high" | "medium" | "low";
}

export function analyzeTestGaps(sourceFiles: { path: string; content: string }[]): { gaps: TestGap[]; summary: string } {
  const testFiles = new Set(
    sourceFiles.filter(f => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"))
      .map(f => {
        // Map test file back to its source file
        const base = f.path.split("/").pop()?.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "") || "";
        return base;
      })
  );

  const gaps: TestGap[] = [];
  for (const file of sourceFiles) {
    if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
    if (file.path.includes(".test.") || file.path.includes(".spec.") || file.path.includes("__tests__")) continue;
    if (file.path.includes("node_modules")) continue;

    const baseName = file.path.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") || "";
    const testFileName1 = `${baseName}.test.${file.path.split(".").pop()}`;
    const testFileName2 = `${baseName}.spec.${file.path.split(".").pop()}`;
    const hasTest = testFiles.has(baseName) || sourceFiles.some(f => f.path.includes(testFileName1) || f.path.includes(testFileName2));

    const controlFlow = (file.content.match(/\b(if|for|while|switch|catch)\s/g) || []).length;
    const complexity = controlFlow > 30 ? "high" : controlFlow > 15 ? "medium" : "low";
    const lineCount = file.content.split("\n").length;

    if (!hasTest && lineCount > 50) {
      gaps.push({
        sourceFile: file.path,
        hasTest,
        complexity,
        priority: complexity === "high" && lineCount > 200 ? "high" : complexity === "high" ? "high" : "medium",
      });
    }
  }

  gaps.sort((a, b) => a.priority === "high" ? -1 : 1);
  return {
    gaps: gaps.slice(0, 20),
    summary: `${gaps.length} source files without tests. ${gaps.filter(g => g.priority === "high").length} high priority (complex files).`,
  };
}

// ─── 4. Change Coupling (co-change detection) ──────────────────────────
export interface CoChangePair {
  fileA: string;
  fileB: string;
  sharedCommits: number;
  rationale: string;
}

export function analyzeChangeCoupling(repoPath?: string): { pairs: CoChangePair[]; summary: string } {
  if (!repoPath || !existsSync(join(repoPath, ".git"))) {
    return { pairs: [], summary: "Change coupling analysis requires a local git repository." };
  }
  try {
    const { execSync } = require("node:child_process");
    // Find files that frequently appear together in commits
    const output = execSync(
      `git log --name-only --format="commit %H" HEAD~200..HEAD 2>/dev/null | awk '/^commit/ { if (count > 1) for (f in files) print files[f]; for (f in files) delete files[f]; count=0; next } { if (!files[$0]++) count++ }' | sort | uniq -c | sort -rn | head -20`,
      { cwd: repoPath, encoding: "utf-8", timeout: 15000 }
    );

    const pairs: CoChangePair[] = [];
    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines.slice(0, 10)) {
      pairs.push({
        fileA: line.replace(/^\s*\d+\s+/, ""),
        fileB: "", sharedCommits: parseInt(line) || 0,
        rationale: `Frequently changed together — consider decoupling`,
      });
    }
    return { pairs, summary: `${pairs.length} co-change patterns detected.` };
  } catch {
    return { pairs: [], summary: "Change coupling analysis requires git history." };
  }
}

// ─── 5. Tech Debt Ratio ───────────────────────────────────────────────
export interface TechDebtMetrics {
  fixableIssues: number;
  estimatedFixHours: number;
  totalSourceLines: number;
  debtRatio: number; // Percentage of total dev time
  summary: string;
}

const FIX_COST: Record<string, number> = {
  critical: 4,   // hours per critical fix
  high: 2,
  medium: 0.5,
  low: 0.1,
};

export function calculateTechDebtRatio(
  codeHygieneFindings?: { severity: string }[],
  complexityReport?: { hotSpots?: { severity: string }[] },
  productionFindings?: { severity: string }[],
  totalSourceLines: number = 1000,
): TechDebtMetrics {
  const allFindings = [
    ...(codeHygieneFindings || []),
    ...(complexityReport?.hotSpots || []),
    ...(productionFindings || []),
  ];

  const fixableIssues = allFindings.length;
  let estimatedFixHours = 0;
  for (const f of allFindings) {
    estimatedFixHours += FIX_COST[f.severity] || 0.5;
  }

  // Assume original dev time at ~50 lines/hour (including design, testing)
  const originalDevHours = totalSourceLines / 50;
  const debtRatio = originalDevHours > 0 ? Math.round((estimatedFixHours / originalDevHours) * 100) : 0;

  return {
    fixableIssues,
    estimatedFixHours,
    totalSourceLines,
    debtRatio,
    summary: `${fixableIssues} fixable issues. ~${estimatedFixHours}h to fix (${debtRatio}% of original build time). ${debtRatio > 30 ? "High debt — consider a refactor sprint." : debtRatio > 15 ? "Moderate debt — address during normal maintenance." : "Low debt — healthy codebase."}`,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────
function monthsSince(dateStr: string): number {
  try {
    const d = new Date(dateStr);
    return Math.floor((Date.now() - d.getTime()) / (30 * 24 * 60 * 60 * 1000));
  } catch { return 99; }
}
