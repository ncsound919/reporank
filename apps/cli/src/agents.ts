#!/usr/bin/env node
import chalk from "chalk";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateGuidelines, estimateContextWindowFit, checkGuidelinesCompliance, getRulesForAnalysis, type CodebaseAnalysis, type ComplianceViolation } from "@reporank/agent-guidelines";
import { runDeepAnalysis } from "@reporank/grading-engine";

function analyzeLocalDirectory(dir: string): CodebaseAnalysis {
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
      vibeCodingScore: Math.min(100, deep.codeHygiene.findings.length * 2),
      securityIssues: deep.production.findings.filter((f: any) => f.type === "config-exposure").length,
      aiGeneratedPatterns: deep.codeHygiene.findings.length,
      hasTests, hasLicense, hasCI, hasDockerfile,
      fileCount: allFiles.length,
      languages: [...langs].map(l => l === "ts" ? "TypeScript" : l === "js" ? "JavaScript" : l),
      teamSize: 1,
      isEducation: false,
      framework: detectFramework(allFiles),
    };
  } catch {
    return defaultAnalysis;
  }
}

function getAllFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirRecursive(dir);
    for (const e of entries) {
      if (e.includes("node_modules") || e.includes(".git") || e.includes("dist")) continue;
      result.push(e);
    }
  } catch { /* ignore */ }
  return result;
}

function readdirRecursive(dir: string): string[] {
  const result: string[] = [];
  const { readdirSync, statSync } = require("node:fs");
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          result.push(...readdirRecursive(full));
        } else {
          result.push(full.replace(dir + "/", "").replace(dir + "\\", ""));
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

export async function agentsGenerateCommand(dir: string | undefined, options: { mode?: string; output?: string; json?: boolean }) {
  const targetDir = dir || ".";
  const mode = (options.mode || "standard") as "minimal" | "standard" | "comprehensive";

  if (!options.json) {
    console.log(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("  ║       RepoRank AGENTS.md Generator        ║"));
    console.log(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
    console.log(`\n  ${chalk.bold("Directory:")} ${chalk.white(targetDir)}`);
    console.log(`  ${chalk.bold("Mode:")} ${chalk.white(mode)}\n`);
  }

  const analysis = analyzeLocalDirectory(targetDir);
  const guidelines = generateGuidelines(mode, analysis);
  const fit = estimateContextWindowFit(guidelines);

  if (options.json) {
    console.log(JSON.stringify({ guidelines, analysis, contextFit: fit }, null, 2));
    return;
  }

  if (!fit.fits) {
    console.log(chalk.yellow(`  ⚠ Warning: ~${fit.tokenEstimate} tokens — may not fit in context window\n`));
  }

  console.log(guidelines);

  if (options.output) {
    writeFileSync(options.output, guidelines, "utf-8");
    console.log(chalk.green(`\n  ✓ Written to ${options.output}\n`));
  } else {
    console.log(chalk.dim(`\n  ~${fit.tokenEstimate} tokens estimated (${fit.fits ? "fits" : "may not fit"})\n`));
    console.log(chalk.dim(`  Use --output <file> to save to a file.\n`));
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
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║         AGENTS.md Compliance Audit         ║"));
  console.log(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
  console.log(`\n  ${chalk.bold("File:")} ${chalk.white(file)}`);
  console.log(`  ${chalk.bold("Score:")} ${report.passed ? chalk.green(report.score + "/100") : chalk.red(report.score + "/100")}`);
  console.log(`  ${chalk.bold("Status:")} ${report.passed ? chalk.green("PASSED") : chalk.red("FAILED")}`);
  console.log(`  ${chalk.bold("Violations:")} ${report.violations.length} (${report.criticalCount} critical)\n`);

  if (report.violations.length > 0) {
    console.log(`  ${chalk.bold("Uncovered rules:")}\n`);
    for (const v of report.violations) {
      const icon = v.severity === "must" ? chalk.red("●") : chalk.yellow("●");
      console.log(`    ${icon} ${v.ruleId}`);
      console.log(`      ${chalk.dim(v.recommendation)}`);
    }
    console.log("");
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
