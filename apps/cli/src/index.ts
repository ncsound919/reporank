#!/usr/bin/env node
/**
 * RepoRank CLI — Grade any GitHub repo from your terminal.
 * Usage: npx @reporank/cli scan <repo-url>
 *        npx @reporank/cli scan https://github.com/owner/repo
 *        npx @reporank/cli scan owner/repo
 *        npx @reporank/cli agents generate
 *        npx @reporank/cli agents audit AGENTS.md
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { scanCommand } from "./scan.js";
import { agentsGenerateCommand, agentsAuditCommand } from "./agents.js";

const program = new Command();

program
  .name("reporank")
  .description("Grade any GitHub repo — security, quality, vibe, architecture, and more")
  .version("0.1.0");

program
  .command("scan")
  .description("Analyze a GitHub repository")
  .argument("<repo>", "Repository URL (https://github.com/owner/repo) or short form (owner/repo)")
  .option("-t, --token <token>", "GitHub personal access token (for higher rate limits)")
  .option("-d, --deep", "Run deep scanners (Semgrep, Trivy, TruffleHog, Hadolint) — requires local installations")
  .option("--json", "Output as JSON instead of formatted report")
  .action(scanCommand);

const agents = program
  .command("agents")
  .description("Generate and audit AGENTS.md governance files");

function wrapAsync<T extends (...args: any[]) => Promise<void>>(fn: T): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    fn(...args).catch((err) => {
      console.error("Command failed:", err);
      process.exit(1);
    });
  };
}

agents
  .command("generate")
  .description("Generate AGENTS.md for a directory")
  .argument("[directory]", "Directory to analyze (default: current)")
  .option("-m, --mode <mode>", "Output mode: minimal, standard, comprehensive (default: standard)")
  .option("-o, --output <file>", "File to write output to")
  .option("--json", "Output as JSON")
  .option("--no-llm", "Skip the LLM-augmented audit (heuristic-only)")
  .action(wrapAsync(agentsGenerateCommand));

agents
  .command("audit")
  .description("Audit an existing AGENTS.md for compliance")
  .argument("<file>", "Path to AGENTS.md file")
  .option("--json", "Output as JSON")
  .action(wrapAsync(agentsAuditCommand));

program
  .command("scan-project")
  .description("Bulk-scan a project with content-hash cache and git delta (Dimension 5)")
  .argument("<directory>", "Project root to scan")
  .option("--use-llm", "Also run LLM on each file (slower, costs tokens)")
  .option("--max-files <n>", "Maximum files to process (default 500)", "500")
  .option("--concurrency <n>", "Concurrent LLM calls (default 2)", "2")
  .action((directory: string, opts) => {
    import("./bulk-scanner.js").then(async (m) => {
      const result = await m.bulkScan({
        repoRoot: resolve(directory),
        useLlm: !!opts.useLlm,
        maxFiles: Number(opts.maxFiles),
        concurrency: Number(opts.concurrency),
      });
      console.log(`\n  Bulk scan results:`);
      console.log(`    Total files:  ${result.totalFiles}`);
      console.log(`    Cached:       ${result.cachedFiles}`);
      console.log(`    Analyzed:     ${result.analyzedFiles}`);
      console.log(`    Findings:     ${result.totalFindings}`);
      console.log(`    Cache hit:    ${(result.cacheHitRate * 100).toFixed(1)}%`);
      console.log(`    Duration:     ${(result.durationMs / 1000).toFixed(2)}s`);
      if (result.errors.length > 0) {
        console.log(`    Errors:       ${result.errors.length}`);
        for (const e of result.errors.slice(0, 5)) {
          console.log(`      ${e.file}: ${e.error}`);
        }
      }
    }).catch((err) => {
      console.error("Bulk scan failed:", err);
      process.exit(1);
    });
  });

program
  .command("verify")
  .description("Quality gate — analyze files/diffs and exit non-zero if quality score < threshold")
  .argument("<path>", "File or directory to analyze")
  .option("--threshold <n>", "Minimum quality score 0-100 (default 70)", "70")
  .option("--diff", "Read git diff from stdin and analyze only changed files")
  .option("--pr <number>", "Analyze the given PR's diff (requires gh CLI)")
  .option("--json", "Output as JSON")
  .option("--gh-markdown", "Output as GitHub-flavored markdown (for PR comments)")
  .option("--no-llm", "Skip LLM scan (heuristic only — fast, no API cost)")
  .option("--detect-hallucinations", "Phase 1.2: detect phantom imports (LLM-hallucinated packages)")
  .option("--mode <mode>", "Prompt mode: zero-shot | few-shot | react | strict (default: strict)", "strict")
  .action((path: string, opts) => {
    import("./verify.js").then(async (m) => {
      const format = opts.json ? "json" : (opts.ghMarkdown ? "gh-markdown" : "text");
      const { report, exitCode } = await m.runVerify({
        path,
        threshold: Number(opts.threshold),
        diff: !!opts.diff,
        pr: opts.pr ? Number(opts.pr) : undefined,
        format,
        noLlm: opts.llm === false,
        promptMode: opts.mode,
        detectHallucinations: !!opts.detectHallucinations,
      });
      if (format === "json") {
        console.log(JSON.stringify(report, null, 2));
      } else if (format === "gh-markdown") {
        console.log(renderGhMarkdown(report));
      } else {
        printTextReport(report);
      }
      process.exit(exitCode);
    }).catch((err) => {
      console.error("Verify failed:", err);
      process.exit(1);
    });
  });

function printTextReport(r: import("./verify.js").VerifyReport): void {
  const verdict = r.passed ? "✓ PASS" : "✗ FAIL";
  console.log(`\n  ${verdict}  Quality score: ${r.qualityScore}/100 (threshold: ${r.config.threshold})`);
  console.log(`  Path: ${r.path}`);
  console.log(`  Files analyzed: ${r.filesAnalyzed}  •  Used LLM: ${r.usedLlm}  •  Duration: ${(r.durationMs / 1000).toFixed(2)}s\n`);
  if (r.findings.length === 0 && !r.hallucinations) {
    console.log("  No findings.");
    return;
  }
  if (r.findings.length > 0) {
    console.log("  By severity:");
    for (const [sev, count] of Object.entries(r.bySeverity).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${sev.padEnd(10)} ${count}`);
    }
    console.log("\n  By category:");
    for (const [cat, count] of Object.entries(r.byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat.padEnd(18)} ${count}`);
    }
    console.log("\n  Findings:");
    for (const f of r.findings.slice(0, 20)) {
      const loc = f.line > 0 ? `:${f.line}` : "";
      const file = f.path ?? "<file>";
      console.log(`    [${f.severity}] ${file}${loc}  ${f.type}  (conf=${(f.confidence * 100).toFixed(0)}%)`);
      console.log(`        ${f.description.slice(0, 100)}`);
    }
    if (r.findings.length > 20) {
      console.log(`    ... and ${r.findings.length - 20} more`);
    }
    console.log();
  }
  if (r.hallucinations && r.hallucinations.hallucinations.length > 0) {
    console.log(`  🚨 Phantom imports (${r.hallucinations.hallucinations.length}):`);
    for (const h of r.hallucinations.hallucinations.slice(0, 20)) {
      console.log(`    [${h.severity}] ${h.file}:${h.line}  ${h.phantomName}  (${h.category})`);
      console.log(`        ${h.recommendation}`);
    }
    if (r.hallucinations.hallucinations.length > 20) {
      console.log(`    ... and ${r.hallucinations.hallucinations.length - 20} more`);
    }
    console.log();
  }
}

function renderGhMarkdown(r: import("./verify.js").VerifyReport): string {
  const verdict = r.passed ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [];
  lines.push(`## ${verdict} reporank verify`);
  lines.push("");
  lines.push(`**Quality score:** ${r.qualityScore}/100 (threshold: ${r.config.threshold})`);
  lines.push(`**Files:** ${r.filesAnalyzed}  •  **LLM:** ${r.usedLlm ? "yes" : "no"}  •  **Duration:** ${(r.durationMs / 1000).toFixed(2)}s`);
  lines.push("");
  if (r.findings.length === 0 && (!r.hallucinations || r.hallucinations.hallucinations.length === 0)) {
    lines.push("No findings. 🎉");
    return lines.join("\n");
  }
  if (r.findings.length > 0) {
    lines.push("### Findings");
    lines.push("");
    lines.push("| Severity | File | Line | Type | Description |");
    lines.push("|----------|------|------|------|-------------|");
    for (const f of r.findings.slice(0, 50)) {
      const loc = f.line > 0 ? String(f.line) : "—";
      const desc = f.description.replace(/\|/g, "\\|").slice(0, 120);
      lines.push(`| ${f.severity} | \`${f.path}\` | ${loc} | \`${f.type}\` | ${desc} |`);
    }
    if (r.findings.length > 50) {
      lines.push(`\n_...and ${r.findings.length - 50} more findings_`);
    }
  }
  if (r.hallucinations && r.hallucinations.hallucinations.length > 0) {
    lines.push("");
    lines.push("### 🚨 Phantom Imports");
    lines.push("");
    lines.push("| Severity | File | Line | Package | Category | Recommendation |");
    lines.push("|----------|------|------|---------|----------|----------------|");
    for (const h of r.hallucinations.hallucinations.slice(0, 30)) {
      const rec = h.recommendation.replace(/\|/g, "\\|").slice(0, 100);
      lines.push(`| ${h.severity} | \`${h.file}\` | ${h.line} | \`${h.phantomName}\` | ${h.category} | ${rec} |`);
    }
  }
  return lines.join("\n");
}

// ─── Phase 6: instructions command ──────────────────────────────────────────
const instructions = program
  .command("instructions")
  .description("Translate, suggest, and gather feedback for agent instructions (Phase 6)");

instructions
  .command("translate <input>")
  .description("Translate an AGENTS.md-style file into another agent format")
  .option("-t, --to <format>", "Target format: cursor | aider | claude | copilot | agents (default: cursor)", "cursor")
  .option("-o, --output <file>", "Override output path (otherwise uses the format's default filename)")
  .action(wrapAsync(async (input: string, opts: { to: string; output?: string }) => {
    const { translateFile, SUPPORTED_TARGET_FORMATS } = await import("./instructions.js");
    if (!SUPPORTED_TARGET_FORMATS.includes(opts.to as never)) {
      console.error(`  Error: unknown format '${opts.to}'. Use one of: ${SUPPORTED_TARGET_FORMATS.join(", ")}`);
      process.exit(1);
    }
    const target = opts.to as "cursor" | "aider" | "claude" | "copilot" | "agents";
    const result = translateFile(input, target, opts.output);
    if (result.status === "error") {
      console.error(`  Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`  Translated ${result.source_path} -> ${result.target} (${result.bytes} bytes)`);
    console.log(`  Wrote: ${result.output_path}`);
  }));

instructions
  .command("suggest <directory>")
  .description("Suggest rules to add to AGENTS.md based on codebase analysis")
  .action(wrapAsync(async (dir: string) => {
    const { suggestRules } = await import("./instructions.js");
    const { analyzeLocalDirectory } = await import("./agents.js");
    const analysis = analyzeLocalDirectory(dir) as unknown as Record<string, unknown>;
    const suggestions = suggestRules(analysis);
    if (suggestions.length === 0) {
      console.log("  No rule suggestions — codebase looks clean.");
      return;
    }
    console.log(`\n  ${suggestions.length} rule suggestion(s):\n`);
    for (const s of suggestions) {
      console.log(`  [${s.severity.toUpperCase()}] ${s.title}`);
      console.log(`    Rationale: ${s.rationale}`);
      console.log(`    Confidence: ${(s.confidence * 100).toFixed(0)}%`);
      console.log(`    Evidence: ${s.evidence.join("; ")}`);
      console.log();
    }
  }));

instructions
  .command("feedback")
  .description("Record feedback on a previously suggested rule (Phase 6.3)")
  .requiredOption("--rule <id>", "Rule ID to give feedback on")
  .option("--accept", "Mark the rule as accepted (added to AGENTS.md)")
  .option("--reject", "Mark the rule as rejected (not relevant)")
  .option("--reason <text>", "Optional reason")
  .action(wrapAsync(async (opts: { rule: string; accept?: boolean; reject?: boolean; reason?: string }) => {
    const { recordFeedback } = await import("./instructions.js");
    if (opts.accept === opts.reject) {
      console.error("  Error: specify exactly one of --accept or --reject");
      process.exit(1);
    }
    const entry = recordFeedback(opts.rule, !!opts.accept, opts.reason);
    console.log(`  Recorded feedback: ${opts.rule} -> ${entry.accepted ? "ACCEPTED" : "REJECTED"}`);
  }));

instructions
  .command("feedback-summary")
  .description("Show aggregate feedback statistics")
  .action(wrapAsync(async () => {
    const { getFeedbackSummary } = await import("./instructions.js");
    const summary = getFeedbackSummary();
    console.log(JSON.stringify(summary, null, 2));
  }));

// ─── Phase 5: deploy command ────────────────────────────────────────────────
const deploy = program
  .command("deploy")
  .description("Generate deployment configs and deploy to Vercel, Docker, Fly, or static hosts (Phase 5)");

deploy
  .command("generate <provider> <project>")
  .description("Generate deployment files for a project (vercel | docker | fly | static)")
  .option("-n, --name <name>", "Override service name")
  .option("-f, --force", "Overwrite existing files")
  .action(async (provider: string, project: string, opts: { name?: string; force?: boolean }) => {
    try {
      const { generateTemplate } = await import("./deploy.js");
      const { written, skipped } = generateTemplate(
        provider as "vercel" | "docker" | "fly" | "static",
        project,
        opts.name,
        { force: opts.force },
      );
      console.log(`\n  Wrote ${written.length} file(s) for ${provider}:`);
      for (const f of written) console.log(`    + ${f}`);
      if (skipped.length > 0) {
        console.log(`\n  Skipped ${skipped.length} existing file(s) (use --force to overwrite):`);
        for (const f of skipped) console.log(`    ~ ${f}`);
      }
    } catch (e) {
      console.error("  Error:", (e as Error).message);
      process.exit(1);
    }
  });

deploy
  .command("plan <project>")
  .description("Preview a deployment plan for the project")
  .option("-p, --provider <provider>", "Provider (vercel | docker | fly | static)", "docker")
  .action(async (project: string, opts: { provider: string }) => {
    try {
      const { planDeploy } = await import("./deploy.js");
      const result = planDeploy({ provider: opts.provider as "vercel" | "docker" | "fly" | "static", projectPath: project });
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error("Plan failed:", (e as Error).message);
      process.exit(1);
    }
  });

deploy
  .command("status <project>")
  .description("Inspect existing deployment files for a project")
  .action(async (project: string) => {
    try {
      const { readDeployStatus } = await import("./deploy.js");
      const status = readDeployStatus(project);
      console.log(JSON.stringify(status, null, 2));
    } catch (e) {
      console.error("Status failed:", (e as Error).message);
      process.exit(1);
    }
  });

deploy
  .command("up <provider> <project>")
  .description("Generate files and (when not --dry-run) trigger provider CLI")
  .option("--dry-run", "Write files but don't invoke provider CLI")
  .option("-f, --force", "Overwrite existing files")
  .option("-n, --name <name>", "Override service name")
  .action(async (provider: string, project: string, opts: { dryRun?: boolean; name?: string; force?: boolean }) => {
    try {
      const { deploy: runDeploy } = await import("./deploy.js");
      const result = await runDeploy({
        provider: provider as "vercel" | "docker" | "fly" | "static",
        projectPath: project,
        name: opts.name,
        force: opts.force,
        dryRun: opts.dryRun !== false, // default to dry-run for safety
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error("Deploy failed:", (e as Error).message);
      process.exit(1);
    }
  });

program
  .command("harness")
  .description("Run the code review accuracy benchmark against a task dataset")
  .option("-d, --dataset <path>", "Path to the task dataset JSON file")
  .option("-o, --output <path>", "Write the full JSON report to this path")
  .option("-m, --mode <mode>", "Prompt mode: zero-shot | few-shot | react | strict (default: strict)", "strict")
  .option("--line-tolerance <n>", "Acceptable line-number deviation (default 2)", "2")
  .option("--concurrency <n>", "Concurrent LLM calls (default 2)", "2")
  .option("--max-chunk-tokens <n>", "Override chunk token budget")
  .option("--temperature <n>", "Override LLM temperature")
  .option("--filter <prefix>", "Run only tasks whose id starts with this prefix")
  .option("--heuristic-only", "Run only the regex/heuristic scanner (no LLM)")
  .option("--llm-only", "Run only the LLM scanner (no heuristic)")
  .option("--min-confidence <n>", "Drop findings below this confidence (0..1, default 0)")
  .action((opts) => {
    // Lazy import so the harness only loads when invoked
    import("./harness.js").then((m) => m.runHarness(opts)).catch((err) => {
      console.error("Failed to run harness:", err);
      process.exit(1);
    });
  });

program.parse(process.argv);
