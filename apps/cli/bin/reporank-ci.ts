// Standalone reporank verify runner for CI integration.
// This is the JavaScript entry point for embedding reporank into
// custom CI pipelines (GitHub Actions, GitLab, Buildkite, etc).
//
// Usage:
//   node reporank-ci.js <path> --diff --threshold 70
//   node reporank-ci.js . --pr 123 --gh-markdown
//
// Environment variables:
//   VIBESERVE_URL         — LLM endpoint (default: http://127.0.0.1:8000)
//   VIBESERVE_API_KEY     — auth key for the endpoint
//   REPORANK_THRESHOLD    — default quality threshold (default: 70)
//   REPORANK_DIFF         — "1" to read diff from stdin (default: off)
//   REPORANK_PR           — PR number to fetch via gh CLI
//   REPORANK_FORMAT       — json | text | gh-markdown (default: text)
//   REPORANK_NO_LLM       — "1" to skip LLM scan
//   REPORANK_DETECT_HALLUCINATIONS — "1" to enable phantom import detection
//   REPORANK_CONCURRENCY  — concurrent file scans (default: 4)

import { spawnSync } from "node:child_process";
import { resolve, relative, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve relative to this file's location so the CI script works
// whether invoked via tsx, node, or as a global install.  On Windows
// we must convert to a file:// URL — bare "C:\..." paths are not
// accepted by the ESM dynamic import loader.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const verifyUrl = pathToFileURL(resolve(__dirname, "../src/verify.js")).href;
const verifyModule = await import(verifyUrl);
const { runVerify } = verifyModule;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  const path = opts.path ?? ".";
  const threshold = opts.threshold ?? Number(process.env.REPORANK_THRESHOLD ?? 70);
  const pr = opts.pr ?? (process.env.REPORANK_PR ? Number(process.env.REPORANK_PR) : undefined);
  const diff = opts.diff ?? process.env.REPORANK_DIFF === "1";
  const format = opts.format ?? process.env.REPORANK_FORMAT ?? "text";
  const noLlm = opts.noLlm ?? process.env.REPORANK_NO_LLM === "1";
  const detectHallucinations = opts.detectHallucinations ?? process.env.REPORANK_DETECT_HALLUCINATIONS === "1";

  if (pr !== undefined) {
    // Fetch PR diff via gh and capture it.  We'll inject this into stdin
    // by writing to process.stdin before runVerify reads it.  Simpler:
    // call runVerify's own --pr path directly — it already handles this.
  }

  const { report, exitCode } = await runVerify({
    path: resolve(path),
    threshold,
    diff,
    pr,
    format,
    noLlm,
    detectHallucinations,
  });

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else if (format === "gh-markdown") {
    console.log(renderGhMarkdown(report));
  } else {
    printTextSummary(report);
  }
  return exitCode;
}

function readStdinSync(): string {
  try { return readFileSync(0, "utf-8"); } catch { return ""; }
}

async function fetchPrDiff(pr: number): Promise<string> {
  const r = spawnSync("gh", ["pr", "diff", String(pr)], {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60_000,
  });
  if (r.status !== 0) {
    throw new Error(`gh pr diff ${pr} failed: ${r.stderr || r.error?.message}`);
  }
  return r.stdout;
}

interface ParsedArgs {
  path?: string;
  threshold?: number;
  diff?: boolean;
  pr?: number;
  format?: "json" | "gh-markdown" | "text";
  noLlm?: boolean;
  detectHallucinations?: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      if (out.path === undefined) out.path = a;
      continue;
    }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = args[i + 1];
    switch (key) {
      case "threshold": out.threshold = Number(next); i++; break;
      case "diff": out.diff = true; break;
      case "pr": out.pr = Number(next); i++; break;
      case "format": out.format = next as ParsedArgs["format"]; i++; break;
      case "noLlm": out.noLlm = true; break;
      case "detectHallucinations": out.detectHallucinations = true; break;
    }
  }
  return out;
}

function renderGhMarkdown(r: any): string {
  // Inline the same renderer as index.ts; kept simple for embedded use.
  const verdict = r.passed ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [
    `## ${verdict} reporank verify`,
    "",
    `**Quality score:** ${r.qualityScore}/100 (threshold: ${r.config.threshold})`,
    `**Files:** ${r.filesAnalyzed}  •  **LLM:** ${r.usedLlm ? "yes" : "no"}  •  **Duration:** ${(r.durationMs / 1000).toFixed(2)}s`,
  ];
  if (r.findings.length > 0) {
    lines.push("", "### Findings", "", "| Severity | File | Line | Type | Description |", "|----------|------|------|------|-------------|");
    for (const f of r.findings.slice(0, 50)) {
      const loc = f.line > 0 ? String(f.line) : "—";
      const desc = f.description.replace(/\|/g, "\\|").slice(0, 120);
      lines.push(`| ${f.severity} | \`${f.path}\` | ${loc} | \`${f.type}\` | ${desc} |`);
    }
  }
  if (r.hallucinations && r.hallucinations.hallucinations.length > 0) {
    lines.push("", "### 🚨 Phantom Imports", "", "| Severity | File | Line | Package | Category | Recomendación |", "|----------|------|------|---------|----------|----------------|");
    for (const h of r.hallucinations.hallucinations.slice(0, 30)) {
      const rec = h.recommendation.replace(/\|/g, "\\|").slice(0, 100);
      lines.push(`| ${h.severity} | \`${h.file}\` | ${h.line} | \`${h.phantomName}\` | ${h.category} | ${rec} |`);
    }
  }
  return lines.join("\n");
}

function printTextSummary(r: any): void {
  const verdict = r.passed ? "✓ PASS" : "✗ FAIL";
  console.log(`\n  ${verdict}  Quality score: ${r.qualityScore}/100 (threshold: ${r.config.threshold})`);
  console.log(`  Files: ${r.filesAnalyzed}  •  LLM: ${r.usedLlm}  •  ${(r.durationMs / 1000).toFixed(2)}s`);
  if (r.findings.length === 0) console.log("  No findings.");
  for (const f of r.findings.slice(0, 10)) {
    console.log(`    [${f.severity}] ${f.path}:${f.line}  ${f.type}`);
  }
  if (r.hallucinations && r.hallucinations.hallucinations.length > 0) {
    console.log(`\n  🚨 ${r.hallucinations.hallucinations.length} phantom import(s):`);
    for (const h of r.hallucinations.hallucinations.slice(0, 10)) {
      console.log(`    [${h.severity}] ${h.phantomName}  ${h.category}`);
    }
  }
}

process.exit(await main());
