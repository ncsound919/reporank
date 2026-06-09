#!/usr/bin/env node
/**
 * RepoRank Quality Gate
 *
 * Reusable script that runs RepoRank's local analysis and enforces quality thresholds.
 * Can be used in pre-commit hooks, CI workflows, or as a standalone check.
 *
 * Usage:
 *   node quality-gate.mjs <directory> [options]
 *
 * Options:
 *   --threshold <num>   Minimum vibe score (default: 50, set to 0 to disable)
 *   --max-secrets <num> Maximum allowed security issues (default: 0)
 *   --require-tests     Fail if no tests found
 *   --json              Output machine-readable JSON report
 *   --cli-path <path>   Path to reporank CLI source (default: ../apps/cli/src/index.ts)
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — Quality checks failed
 *   2 — Unexpected error (bad path, parse failure, etc.)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Parse Named Args ─────────────────────────────────────────
function getArgValue(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1) return process.argv[idx + 1];
  const equals = process.argv.find(a => a.startsWith(name + "="));
  if (equals) return equals.split("=")[1];
  return defaultValue;
}

const args = process.argv.slice(2);
const targetDir = resolve(args[0] || ".");
const threshold = parseInt(getArgValue("--threshold", "50"), 10);
const maxSecrets = parseInt(getArgValue("--max-secrets", "0"), 10);
const requireTests = args.includes("--require-tests");
const jsonOutput = args.includes("--json");
const cliPathArg = getArgValue("--cli-path", null);
const cliPath = cliPathArg ? resolve(cliPathArg) : resolve(__dirname, "..", "apps", "cli", "src", "index.ts");

// ─── Run RepoRank Analysis ─────────────────────────────────────
function runQualityGate() {
  // Validate paths
  if (!existsSync(targetDir)) {
    return { passed: false, error: `Target directory not found: ${targetDir}`, exitCode: 2 };
  }
  if (!existsSync(cliPath)) {
    return { passed: false, error: `RepoRank CLI not found at: ${cliPath}`, exitCode: 2 };
  }

  // Execute agents generate with JSON output
  // Use absolute paths and shell:true for reliable Windows execution
  // Must run from the reporank monorepo root so tsx resolves workspace packages correctly
  const reporankRoot = resolve(cliPath, "..", "..", "..", "..");
  let raw;
  try {
    raw = execSync(
      `npx tsx "${cliPath}" agents generate "${targetDir}" --mode standard --json`,
      { encoding: "utf-8", timeout: 60000, cwd: reporankRoot, shell: true }
    );
  } catch (err) {
    // execSync throws on non-zero exit or stderr output
    // stdout still has the JSON output we need
    if (err.stdout) {
      raw = err.stdout.toString("utf-8");
    } else {
      return { passed: false, error: `RepoRank CLI failed: ${err.message}`, exitCode: 2 };
    }
  }

  // Parse results
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { passed: false, error: "Failed to parse RepoRank CLI output", exitCode: 2 };
  }

  const analysis = data.analysis || {};
  const score = analysis.vibeCodingScore ?? 0;
  const secrets = analysis.securityIssues ?? 0;
  const hasTests = analysis.hasTests ?? false;
  const fileCount = analysis.fileCount ?? 0;
  const languages = analysis.languages ?? [];
  const aiPatterns = analysis.aiGeneratedPatterns ?? 0;

  // ─── Evaluate Checks ───────────────────────────────────────
  const checks = [];

  // Check 1: Vibe score threshold
  const scorePassed = score >= threshold;
  checks.push({
    name: "Vibe score threshold",
    passed: scorePassed,
    message: scorePassed
      ? `Score ${score}/${threshold} ✓`
      : `Score ${score} is below threshold ${threshold}`,
    value: score,
    threshold,
  });

  // Check 2: Security issues
  const secretsPassed = secrets <= maxSecrets;
  checks.push({
    name: "Security issues",
    passed: secretsPassed,
    message: secretsPassed
      ? `${secrets} security issues (max ${maxSecrets}) ✓`
      : `${secrets} security issues exceeds maximum ${maxSecrets}`,
    value: secrets,
    threshold: maxSecrets,
  });

  // Check 3: Tests (optional)
  let testsPassed = true;
  if (requireTests) {
    testsPassed = hasTests;
    checks.push({
      name: "Tests required",
      passed: testsPassed,
      message: testsPassed ? "Tests found ✓" : "No tests found — test coverage required",
      value: hasTests,
      threshold: true,
    });
  }

  // Summary
  const allPassed = checks.every((c) => c.passed);
  const result = {
    passed: allPassed,
    exitCode: allPassed ? 0 : 1,
    target: targetDir,
    timestamp: new Date().toISOString(),
    analysis: {
      score,
      secrets,
      hasTests,
      fileCount,
      languages,
      aiGeneratedPatterns: aiPatterns,
    },
    checks,
  };

  return result;
}

// ─── Output ────────────────────────────────────────────────────
const result = runQualityGate();

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.error) {
  console.error(`\n  ❌ RepoRank Quality Gate — ERROR\n`);
  console.error(`  ${result.error}`);
  console.error("");
} else {
  console.log("");
  console.log("  ┌───────────────────────────────────────────────┐");
  console.log("  │         RepoRank Quality Gate                 │");
  console.log("  └───────────────────────────────────────────────┘");
  console.log(`  Target: ${result.target}`);
  console.log(`  Files:  ${result.analysis?.fileCount ?? "?"} source files${result.analysis?.languages?.length ? ` (${result.analysis.languages.join(", ")})` : ""}`);
  console.log("");

  const checks = result.checks || [];
  for (const check of checks) {
    const icon = check.passed ? "✓" : "✗";
    console.log(`  ${icon}  ${check.name}: ${check.message}`);
  }

  console.log(`\n  ${result.passed ? "✅ ALL CHECKS PASSED" : "❌ QUALITY GATE FAILED"}`);
  console.log("");
}

process.exit(result.exitCode);
