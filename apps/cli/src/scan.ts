import chalk from "chalk";
import cliProgress from "cli-progress";
import { resolve } from "node:path";
import { runDeepAnalysis, computeStructuralIndex } from "@reporank/grading-engine";
import { runSemgrep } from "./scanners/semgrep-runner";
import { SEMGREP_PRESETS } from "./scanners/rule-presets";
import { runAuditCore, toSharedFindings } from "./core-client";
import {
  buildScanFindings,
  gradeDimensions,
  scanSecrets,
  weightedOverall,
  type ScanFinding,
  type SecretHit,
} from "./scan-findings";

interface ScanOptions { token?: string; deep?: boolean; json?: boolean; }

export async function scanCommand(repo: string, options: ScanOptions) {
  // Parse repo identifier
  const match = repo.match(/(?:github\.com\/)?([^\/]+)\/([^\/\.]+)/);
  if (!match) { console.error(chalk.red("Invalid repository format. Use: owner/repo or https://github.com/owner/repo")); process.exit(1); }
  const [_, owner, name] = match;
  const displayName = `${owner}/${name}`;

  if (!options.json) {
    process.stdout.write(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
    process.stdout.write(chalk.bold.cyan("  ║          RepoRank Codebase Audit           ║"));
    process.stdout.write(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
    process.stdout.write(`\n  ${chalk.bold("Repository:")} ${chalk.white(displayName)}`);
    process.stdout.write("");
  }

  const bar = options.json ? null : new cliProgress.SingleBar({ format: "  {bar} {percentage}% | {value}/{total} | {status}", barCompleteChar: "█", barIncompleteChar: "░", hideCursor: true }, cliProgress.Presets.shades_classic);

  try {
    if (bar) { bar.start(6, 0, { status: "Fetching repo data..." }); }

    // 1. Fetch repo data from GitHub API
    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const gh = async (path: string) => {
      const r = await fetch(`https://api.github.com${path}`, { headers });
      if (!r.ok) throw new Error(`GitHub API ${r.status}: ${r.statusText}`);
      return r.json();
    };

    const repoData = await gh(`/repos/${owner}/${name}`);
    if (bar) bar.update(1, { status: "Fetching README + file tree..." });

    let readme = "";
    try { const rd = await gh(`/repos/${owner}/${name}/readme`); readme = Buffer.from(rd.content, "base64").toString("utf-8"); } catch {}

    const tree = await gh(`/repos/${owner}/${name}/git/trees/${repoData.default_branch}?recursive=1`);
    const fileTree = (tree.tree || []).map((i: any) => i.path);
    if (bar) bar.update(2, { status: "Reading key source files..." });

    let packageJson = "";
    try { const pkg = await gh(`/repos/${owner}/${name}/contents/package.json`); packageJson = Buffer.from(pkg.content, "base64").toString("utf-8"); } catch {}

    const srcExts = new Set([".ts",".tsx",".js",".jsx",".py",".go",".rs",".java",".rb",".php",".vue",".svelte"]);
    const candidates = fileTree.filter((f: string) => srcExts.has(f.slice(f.lastIndexOf("."))));

    // Stratified sampling: take up to 5 files per top-level directory, max 50 total
    const byDir = new Map<string, string[]>();
    for (const p of candidates) {
      const topDir = p.includes("/") ? p.split("/")[0] : "__root__";
      if (!byDir.has(topDir)) byDir.set(topDir, []);
      byDir.get(topDir)!.push(p);
    }
    const sampled: string[] = [];
    const buckets = [...byDir.values()].map(fs => fs.slice(0, 5));
    let moreFiles = true;
    while (sampled.length < 50 && moreFiles) {
      moreFiles = false;
      for (const bucket of buckets) {
        if (sampled.length >= 50) break;
        const next = bucket.shift();
        if (next !== undefined) { sampled.push(next); moreFiles = true; }
      }
    }

    const sourceFiles: { path: string; content: string }[] = [];
    for (const fp of sampled) {
      try { const f = await gh(`/repos/${owner}/${name}/contents/${fp}`); sourceFiles.push({ path: fp, content: Buffer.from(f.content, "base64").toString("utf-8").slice(0, 15000) }); } catch {}
    }
    if (bar) bar.update(3, { status: "Running deterministic deep analysis..." });

    // 2. Deterministic deep analysis (grading-engine). Powers structured
    //    findings and the config/dependency dimensions — no LLM involved.
    const deep = runDeepAnalysis(null, fileTree, sourceFiles, packageJson);
    const secrets: SecretHit[] = scanSecrets(sourceFiles);
    const findings: ScanFinding[] = buildScanFindings(deep, secrets);
    if (bar) bar.update(4, { status: "Running vibe analysis..." });

    // 3. Heuristic vibe analysis (naming/modernity/hygiene).
    const vibe = await runVibeAnalysis(fileTree, sourceFiles, deep, packageJson.length > 0);

    // 3b. Optional local Semgrep deep scan.
    const deepFindings: ScanFinding[] = [];
    if (options.deep) {
      try {
        const presetKey = "default";
        const config = SEMGREP_PRESETS[presetKey as keyof typeof SEMGREP_PRESETS] as string[];
        const targetDir = resolve(process.cwd(), repo);
        const semgrep = await runSemgrep(targetDir, config);
        for (const f of semgrep.findings) {
          deepFindings.push({
            category: f.category,
            severity: f.severity === "error" ? "critical" : f.severity === "warning" ? "medium" : "low",
            line: f.line > 0 ? f.line : undefined,
            path: f.path,
            type: f.ruleId.split(".").slice(-1)[0] || "semgrep",
            description: f.message,
            recommendation: `See: https://semgrep.dev/r/${f.ruleId}`,
            confidence: 0.9,
            located: true,
            source: "semgrep",
          });
        }
        findings.push(...deepFindings);
      } catch (e: any) {
        if (!options.json) console.error(chalk.yellow(`  ⚠ Semgrep deep scan: ${e.message}`));
      }
    }

    // 3c. Optional validation/lifecycle/gate via OpenHub's shared audit core.
    //     A core outage is a soft failure — it must never fail the scan.
    let core: unknown;
    const coreUrl = process.env.OPENHUB_CORE_URL;
    if (coreUrl) {
      const result = await runAuditCore({
        baseUrl: coreUrl,
        token: process.env.OPENHUB_TOKEN,
        targetDir: process.cwd(),
        findings: toSharedFindings(findings),
      });
      if (result.ok) {
        core = result.core;
        if (!options.json) process.stdout.write(chalk.dim(`  ${coreSummaryLine(result.core)}`));
      } else {
        core = { ok: false, error: result.error };
        if (!options.json) console.error(chalk.yellow(`  ⚠ OpenHub core: ${result.error}`));
      }
    }

    if (bar) bar.update(5, { status: "Generating report..." });

    // 4. Build and display report
    if (options.json) {
      // Deterministic, decomposable structural index (no LLM). Emitted
      // alongside the heuristic vibe score so the JSON is auditable.
      const totalLoc = sourceFiles.reduce((s, f) => s + f.content.split(/\r?\n/).length, 0);
      const structuralIndex = computeStructuralIndex(deep, {
        mainLanguage: repoData.language || "unknown",
        totalLoc,
        structure: deep.structure,
        deadCode: deep.deadCode,
      });
      const output: any = {
        repo: displayName,
        score: vibe.overall,
        index: structuralIndex.index,
        decomposition: structuralIndex.contributions,
        normalization: structuralIndex.normalization,
        indexFormula: structuralIndex.formula,
        vibe,
        secrets,
        files: fileTree.length,
        findings,
        unmeasured: vibe.unmeasured,
      };
      if (core !== undefined) output.core = core;
      if (options.deep) output.deep = deepFindings;
      process.stdout.write(JSON.stringify(output, null, 2));
    } else {
      displayReport(displayName, repoData, fileTree, vibe, secrets, findings);
    }

    if (bar) { bar.update(6, { status: "Done!" }); bar.stop(); }
    if (!options.json) process.stdout.write(chalk.green("\n  ✓ Scan complete.\n"));

  } catch (err: any) {
    if (bar) bar.stop();
    console.error(chalk.red(`\n  ✗ Error: ${err.message}\n`));
    process.exit(1);
  }
}

interface CoreSummary {
  validation?: { confirmed?: number; stale?: number };
  gate?: { passed?: boolean };
}

/** Short, honest one-liner for the optional OpenHub core result. */
function coreSummaryLine(core: unknown): string {
  const c = (core ?? {}) as CoreSummary;
  const confirmed = c.validation?.confirmed ?? 0;
  const stale = c.validation?.stale ?? 0;
  const gate = c.gate?.passed === true ? "pass" : c.gate?.passed === false ? "fail" : "unknown";
  return `OpenHub core: confirmed=${confirmed} stale=${stale} gate=${gate}`;
}

async function runVibeAnalysis(
  files: string[],
  sources: { path: string; content: string }[],
  deep: ReturnType<typeof runDeepAnalysis>,
  hasPackageJson: boolean,
) {
  // Naming conventions
  const conventions: Record<string, number> = { camelCase: 0, snake_case: 0, "kebab-case": 0, PascalCase: 0 };
  let total = 0;
  for (const file of files) {
    const name = (file.split("/").pop() || file).split(".").slice(0, -1).join(".");
    if (!name) continue;
    if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conventions.camelCase++;
    else if (/^[a-z][a-z0-9_]*$/.test(name)) conventions.snake_case++;
    else if (/^[a-z][a-z0-9-]*$/.test(name)) conventions["kebab-case"]++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) conventions.PascalCase++;
    total++;
  }
  const sorted = Object.entries(conventions).sort((a, b) => b[1] - a[1]);
  const namingScore = total > 0 ? (sorted[0][1] / total) * 100 : 100;

  // Modernity
  let hasAsync = false, hasHooks = false, hasTS = false, callbacks = 0, consoleLogs = 0, commented = 0, TASKS = 0;
  for (const file of sources) {
    const c = file.content;
    if (c.match(/\bawait\b/g)) hasAsync = true;
    if (c.match(/use[A-Z][a-zA-Z]*\s*\(/g)) hasHooks = true;
    if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) hasTS = true;
    callbacks += (c.match(/\.(then|catch)\s*\(function/g) || []).length;
    consoleLogs += (c.match(/console\.(log|warn|error|debug)\(/g) || []).length;
    commented += (c.match(/\/\/\s*.+[;{}]/gm) || []).length;
    TASKS += (c.match(/\/\/\s*(TASK|FIX_NOW|HACK)/gi) || []).length;
  }
  let modernityScore = 0;
  if (hasAsync) modernityScore += 30;
  if (callbacks === 0) modernityScore += 20;
  if (hasHooks) modernityScore += 25;
  if (hasTS) modernityScore += 25;

  let hygieneScore = 100;
  if (commented > 10) hygieneScore -= 30;
  if (TASKS > 5) hygieneScore -= 15;
  if (consoleLogs > 5) hygieneScore -= 15;
  hygieneScore = Math.max(0, hygieneScore);

  const dims = gradeDimensions(deep, hasPackageJson);
  const roundedNaming = Math.round(namingScore);
  const overall = weightedOverall({
    naming: roundedNaming,
    modernity: modernityScore,
    hygiene: hygieneScore,
    configCoherence: dims.configCoherence,
    dependencyFreshness: dims.dependencyFreshness,
  });

  const heuristicRecommendations = [
    namingScore < 70 ? "Mixed naming conventions — pick one style" : "",
    !hasAsync ? "Use async/await instead of callbacks" : "",
    !hasHooks ? "Adopt React hooks pattern" : "",
    !hasTS ? "Add TypeScript for type safety" : "",
    consoleLogs > 5 ? `Remove ${consoleLogs} console.log statements` : "",
    commented > 10 ? `Clean up ${commented} commented-out code blocks` : "",
  ].filter(Boolean);

  return {
    overall,
    namingScore: roundedNaming, modernityScore, hygieneScore,
    // Dimensions below are measured by grading-engine analyzers, never hardcoded.
    configCoherence: dims.configCoherence,
    dependencyFreshness: dims.dependencyFreshness,
    provenance: {
      naming: { score: roundedNaming, measured: true, source: "heuristic:naming-convention" },
      modernity: { score: modernityScore, measured: true, source: "heuristic:modernity-patterns" },
      hygiene: { score: hygieneScore, measured: true, source: "heuristic:hygiene-patterns" },
      ...dims.provenance,
    },
    unmeasured: dims.unmeasured,
    recommendations: [...deep.topRecommendations, ...heuristicRecommendations].slice(0, 10),
  };
}

function displayReport(displayName: string, repoData: any, fileTree: string[], vibe: any, secrets: any, findings: ScanFinding[]) {
  const colorFor = (score: number) => score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;

  process.stdout.write(`  ${chalk.bold("Score:")}        ${colorFor(vibe.overall)(`${vibe.overall}/100`)}`);
  process.stdout.write(`  ${chalk.bold("Files:")}        ${fileTree.length}`);
  process.stdout.write(`  ${chalk.bold("Findings:")}     ${findings.length} (${findings.filter((f) => f.located).length} located)`);
  process.stdout.write(`  ${chalk.bold("Language:")}     ${repoData.language || "Unknown"}`);
  process.stdout.write(`  ${chalk.bold("Stars:")}        ${repoData.stargazers_count || 0}  ${chalk.dim(`| Forks: ${repoData.forks_count || 0} | Issues: ${repoData.open_issues_count || 0}`)}`);
  process.stdout.write(`  ${chalk.bold("Last push:")}    ${repoData.pushed_at ? new Date(repoData.pushed_at).toLocaleDateString() : "Unknown"}`);

  process.stdout.write(`\n  ${chalk.bold("┌─────────────┬──────┐")}`);
  const dims: [string, number | null][] = [["Naming", vibe.namingScore], ["Modernity", vibe.modernityScore], ["Hygiene", vibe.hygieneScore], ["Config", vibe.configCoherence], ["Deps Fresh", vibe.dependencyFreshness]];
  for (const [label, score] of dims) {
    if (score === null || score === undefined) {
      process.stdout.write(`  ${chalk.bold("│")} ${label.padEnd(11)} ${chalk.bold("│")} ${chalk.dim("unmeasured".padEnd(10))} ${chalk.dim("N/A")} ${chalk.bold("│")}`);
      continue;
    }
    const bar = "█".repeat(Math.floor(score / 10)) + "░".repeat(10 - Math.floor(score / 10));
    process.stdout.write(`  ${chalk.bold("│")} ${label.padEnd(11)} ${chalk.bold("│")} ${colorFor(score)(bar)} ${colorFor(score)(score)} ${chalk.bold("│")}`);
  }
  process.stdout.write(`  ${chalk.bold("└─────────────┴──────┘")}`);

  const secretHits: SecretHit[] = (secrets.secrets ?? []).slice(0, 5);
  if (secretHits.length > 0) {
    process.stdout.write(`\n  ${chalk.red.bold(`⚠ ${secrets.secretsFound} secret(s) detected:`)}`);
    for (const s of secretHits) process.stdout.write(`    ${chalk.red("●")} ${s.type} at ${s.path}:${s.line}`);
  }

  if (vibe.recommendations.length > 0) {
    process.stdout.write(`\n  ${chalk.bold("Recommendations:")}`);
    for (const r of vibe.recommendations) process.stdout.write(`    ${chalk.cyan("→")} ${r}`);
  }

  if (repoData.license?.spdx_id) {
    process.stdout.write(`\n  ${chalk.dim(`License: ${repoData.license.spdx_id}`)}`);
  } else {
    process.stdout.write(`\n  ${chalk.red("⚠ No license detected — enterprise blocker")}`);
  }

  process.stdout.write(`  ${chalk.dim("─".repeat(46))}`);

  // Only print a report URL if the scan was persisted via the API (REPORANK_API_KEY is set).
  // Otherwise, guide the user to the --json flag to get machine-readable output locally.
  if (process.env.REPORANK_API_KEY) {
    process.stdout.write(`  ${chalk.dim("Full report:")} ${chalk.cyan(`https://reporank.dev/report/${displayName}`)}`);
  } else {
    process.stdout.write(`  ${chalk.dim("For full machine-readable output run:")} ${chalk.cyan(`npx @reporank/cli scan --json ${displayName}`)}`);
    process.stdout.write(`  ${chalk.dim("Sign in at")} ${chalk.cyan("https://reporank.dev")} ${chalk.dim("to save & share persistent reports.")}`);
  }

  process.stdout.write(`  ${chalk.dim("─".repeat(46))}`);
}
