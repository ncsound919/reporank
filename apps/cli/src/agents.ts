#!/usr/bin/env node
import chalk from "chalk";
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { generateGuidelines, estimateContextWindowFit, checkGuidelinesCompliance, getRulesForAnalysis, type CodebaseAnalysis, type ComplianceViolation } from "@reporank/agent-guidelines";
// Import from grading-engine's public API — this is a monorepo-internal dependency
import { runDeepAnalysis, calculateVibeCodingIndex } from "@reporank/grading-engine";
import { llmAudit, type LLMAuditResult, LLMUnavailableError } from "./llm";

export function analyzeLocalDirectory(dir: string, opts: { llmFindings?: LLMAuditResult | null } = {}): CodebaseAnalysis {
  const defaultAnalysis: CodebaseAnalysis = {
    vibeCodingScore: 0, securityIssues: 0, aiGeneratedPatterns: 0,
    hasTests: false, hasLicense: false, hasCI: false, hasDockerfile: false,
    fileCount: 0, languages: [], teamSize: 1, isEducation: false, framework: "unknown",
  };

  try {
    const allFiles = getAllFiles(dir);
    const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]);
    const sourceFiles = allFiles.filter((f: string) => sourceExts.has(f.slice(f.lastIndexOf(".")))).slice(0, 50).map((fp: string) => {
      try { return { path: fp, content: readFileSync(join(dir, fp), "utf-8").slice(0, 10000) }; } catch { return null; }
    }).filter(Boolean) as { path: string; content: string }[];

    const deep = runDeepAnalysis(dir, allFiles, sourceFiles, "{}");
    const hasCI = existsSync(join(dir, ".github")) || existsSync(join(dir, ".gitlab-ci.yml"));
    const hasTests = sourceFiles.some(f => f.path.includes(".test.") || f.path.includes(".spec."));
    const hasLicense = allFiles.some(f => /^LICENSE/i.test(f));
    const hasDockerfile = allFiles.some(f => f.toLowerCase() === "dockerfile");
    const langs = new Set(sourceFiles.map(f => f.path.split(".").pop() || ""));

    return {
      vibeCodingScore: calculateVibeCodingIndex(sourceFiles, allFiles).overallScore,
      securityIssues: deep.production.findings.filter((f: any) => f.type === "config-exposure").length
        + (opts.llmFindings?.findings.filter((f) => f.category === "security").length ?? 0),
      aiGeneratedPatterns: deep.codeHygiene.findings.length
        + (opts.llmFindings?.findings.length ?? 0),
      hasTests, hasLicense, hasCI, hasDockerfile,
      fileCount: allFiles.length,
      languages: [...new Set([...langs].map(l => l === "ts" || l === "tsx" ? "TypeScript" : l === "js" || l === "jsx" ? "JavaScript" : l))],
      teamSize: 1,
      isEducation: false,
      framework: detectFramework(allFiles),
    };
  } catch {
    return defaultAnalysis;
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".cache", ".turbo", "build"]);

function getAllFiles(dir: string): string[] {
  return readdirRecursive(dir, dir);
}

function readdirRecursive(dir: string, rootDir: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip early: avoid even traversing into massive directories like node_modules
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          result.push(...readdirRecursive(full, rootDir));
        } else {
          // Get path relative to the original root directory
          result.push(full.slice(rootDir.length + 1));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result;
}

function detectFramework(files: string[]): string {
  const all = files.join(" ");
  if (all.includes("package.json") && all.includes("tsconfig.json")) return "TypeScript";
  if (all.includes("package.json") && all.includes("next.config")) return "Next.js";
  if (all.includes("Cargo.toml")) return "Rust";
  if (all.includes("go.mod")) return "Go";
  if (all.includes("requirements.txt") || all.includes("setup.py")) return "Python";
  return "unknown";
}

export async function agentsGenerateCommand(dir: string | undefined, options: { mode?: string; output?: string; json?: boolean; noLlm?: boolean }) {
  const targetDir = dir || ".";
  const mode = (options.mode || "standard") as "minimal" | "standard" | "comprehensive";
  const useLlm = !options.noLlm;

  if (!options.json) {
    process.stdout.write(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
    process.stdout.write(chalk.bold.cyan("  ║       RepoRank AGENTS.md Generator        ║"));
    process.stdout.write(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
    process.stdout.write(`\n  ${chalk.bold("Directory:")} ${chalk.white(targetDir)}`);
    process.stdout.write(`  ${chalk.bold("Mode:")}      ${chalk.white(mode)}`);
    process.stdout.write(`  ${chalk.bold("LLM:")}       ${chalk.white(useLlm ? "enabled" : "disabled (--no-llm)")}\n`);
  }

  // Phase 0: Optionally run an LLM audit to enrich the heuristic analysis
  let llmFindings: LLMAuditResult | null = null;
  let llmStatus: "skipped" | "ok" | "unavailable" | "error" = "skipped";
  if (useLlm) {
    try {
      // Load a small slice of source files for the LLM
      const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]);
      const allFiles = getAllFiles(targetDir);
      const sources = allFiles
        .filter((f: string) => sourceExts.has(f.slice(f.lastIndexOf("."))))
        .slice(0, 8)
        .map((fp: string) => {
          try { return { path: fp, content: readFileSync(join(targetDir, fp), "utf-8").slice(0, 10000) }; }
          catch { return null; }
        })
        .filter(Boolean) as { path: string; content: string }[];

      if (sources.length > 0) {
        llmFindings = await llmAudit(sources, `RepoRank audit mode=${mode}`);
        llmStatus = llmFindings ? "ok" : "unavailable";
        if (!options.json && llmFindings) {
          process.stdout.write(chalk.dim(`  LLM: ${llmFindings.findings.length} findings (confidence=${llmFindings.confidence.toFixed(2)})`));
        }
      } else {
        llmStatus = "skipped";
      }
    } catch (err) {
      llmStatus = "error";
      if (!options.json) {
        const msg = err instanceof LLMUnavailableError ? err.message : (err as Error).message;
        process.stdout.write(chalk.yellow(`  LLM: unavailable (${msg}) — falling back to heuristic analysis`));
      }
    }
  }

  const analysis = analyzeLocalDirectory(targetDir, { llmFindings });
  const guidelines = generateGuidelines(mode, analysis);
  const fit = estimateContextWindowFit(guidelines);

  if (options.json) {
    process.stdout.write(JSON.stringify({ guidelines, analysis, contextFit: fit, llm: { status: llmStatus, findings: llmFindings?.findings || [] } }, null, 2));
    return;
  }

  if (!fit.fits) {
    process.stdout.write(chalk.yellow(`  ⚠ Warning: ~${fit.tokenEstimate} tokens — may not fit in context window\n`));
  }

  process.stdout.write(guidelines);

  if (options.output) {
    writeFileSync(options.output, guidelines, "utf-8");
    process.stdout.write(chalk.green(`\n  ✓ Written to ${options.output}\n`));
  } else {
    process.stdout.write(chalk.dim(`\n  ~${fit.tokenEstimate} tokens estimated (${fit.fits ? "fits" : "may not fit"})\n`));
    process.stdout.write(chalk.dim(`  Use --output <file> to save to a file.\n`));
  }
}

export async function agentsAuditCommand(file: string, options: { json?: boolean }) {
  if (!existsSync(file)) {
    console.error(chalk.red(`  ✗ File not found: ${file}`));
    process.exit(1);
  }

  const content = readFileSync(file, "utf-8");
  const analysis = analyzeLocalDirectory(".");
  const violations: ComplianceViolation[] = buildViolations(analysis);

  const report = checkGuidelinesCompliance(content, violations);

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  process.stdout.write(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
  process.stdout.write(chalk.bold.cyan("  ║         AGENTS.md Compliance Audit         ║"));
  process.stdout.write(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
  process.stdout.write(`\n  ${chalk.bold("File:")} ${chalk.white(file)}`);
  process.stdout.write(`  ${chalk.bold("Score:")} ${report.passed ? chalk.green(report.score + "/100") : chalk.red(report.score + "/100")}`);
  process.stdout.write(`  ${chalk.bold("Status:")} ${report.passed ? chalk.green("PASSED") : chalk.red("FAILED")}`);
  process.stdout.write(`  ${chalk.bold("Violations:")} ${report.violations.length} (${report.criticalCount} critical)\n`);

  if (report.violations.length > 0) {
    process.stdout.write(`  ${chalk.bold("Uncovered rules:")}\n`);
    for (const v of report.violations) {
      const icon = v.severity === "must" ? chalk.red("●") : chalk.yellow("●");
      process.stdout.write(`    ${icon} ${v.ruleId}`);
      process.stdout.write(`      ${chalk.dim(v.recommendation)}`);
    }
    process.stdout.write("");
  }
}

function buildViolations(analysis: CodebaseAnalysis): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];
  if (analysis.securityIssues > 0) {
    violations.push({ ruleId: "no-secrets-in-code", severity: "must", detail: `${analysis.securityIssues} potential secrets found`, recommendation: "Use environment variables for secrets" });
  }
  if (analysis.aiGeneratedPatterns > 5) {
    violations.push({ ruleId: "no-any-abuse", severity: "should", detail: `${analysis.aiGeneratedPatterns} AI-generated patterns found`, recommendation: "Review AI-generated code for quality" });
  }
  if (!analysis.hasTests) {
    violations.push({ ruleId: "write-tests", severity: "should", file: "tests/", detail: "No tests found", recommendation: "Add tests for core functionality" });
  }
  if (!analysis.hasLicense) {
    violations.push({ ruleId: "no-secrets-in-code", severity: "should", detail: "No license file found", recommendation: "Add a license file" });
  }
  return violations;
}
