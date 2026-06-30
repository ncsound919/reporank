import chalk from "chalk";
import cliProgress from "cli-progress";
import { resolve } from "node:path";
import { runSemgrep } from "./scanners/semgrep-runner";
import { SEMGREP_PRESETS } from "./scanners/rule-presets";

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
    const sourceFiles: { path: string; content: string }[] = [];
    for (const fp of fileTree.filter((f: string) => srcExts.has(f.slice(f.lastIndexOf(".")))).slice(0, 10)) {
      try { const f = await gh(`/repos/${owner}/${name}/contents/${fp}`); sourceFiles.push({ path: fp, content: Buffer.from(f.content, "base64").toString("utf-8").slice(0, 15000) }); } catch {}
    }
    if (bar) bar.update(3, { status: "Running vibe analysis..." });

    // 2. Run vibe analysis
    const vibe = await runVibeAnalysis(fileTree, sourceFiles);
    if (bar) bar.update(4, { status: "Running security + deep analysis..." });

    // 3. Run security + analysis
    const secrets = await runSecretsScan(sourceFiles);

    // 3b. Deep scan with Semgrep
    const deepFindings: any[] = [];
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
            line: f.line,
            type: f.ruleId.split(".").slice(-1)[0] || "semgrep",
            description: f.message,
            recommendation: `See: https://semgrep.dev/r/${f.ruleId}`,
            confidence: 0.9,
          });
        }
      } catch (e: any) {
        if (!options.json) console.error(chalk.yellow(`  ⚠ Semgrep deep scan: ${e.message}`));
      }
    }

    if (bar) bar.update(5, { status: "Generating report..." });

    // 4. Build and display report
    if (options.json) {
      const output: any = { repo: displayName, score: vibe.overall, vibe, secrets, files: fileTree.length };
      if (options.deep) output.deep = deepFindings;
      process.stdout.write(JSON.stringify(output, null, 2));
    } else {
      displayReport(displayName, repoData, fileTree, vibe, secrets);
    }

    if (bar) { bar.update(6, { status: "Done!" }); bar.stop(); }
    if (!options.json) process.stdout.write(chalk.green("\n  ✓ Scan complete.\n"));

  } catch (err: any) {
    if (bar) bar.stop();
    console.error(chalk.red(`\n  ✗ Error: ${err.message}\n`));
    process.exit(1);
  }
}

async function runVibeAnalysis(files: string[], sources: { path: string; content: string }[]) {
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

  return {
    overall: Math.round(namingScore * 0.25 + modernityScore * 0.25 + hygieneScore * 0.20 + 75 * 0.15 + 65 * 0.15),
    namingScore: Math.round(namingScore), modernityScore, hygieneScore,
    configCoherence: 75, dependencyFreshness: 65,
    recommendations: [
      namingScore < 70 ? "Mixed naming conventions — pick one style" : "",
      !hasAsync ? "Use async/await instead of callbacks" : "",
      !hasHooks ? "Adopt React hooks pattern" : "",
      !hasTS ? "Add TypeScript for type safety" : "",
      consoleLogs > 5 ? `Remove ${consoleLogs} console.log statements` : "",
      commented > 10 ? `Clean up ${commented} commented-out code blocks` : "",
    ].filter(Boolean),
  };
}

async function runSecretsScan(sources: { path: string; content: string }[]) {
  const secretPatterns = [
    { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
    { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
    { name: "openai-api-key", pattern: /sk-[A-Za-z0-9]{20,}/g },
    { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
    { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g },
    { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi },
    { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g },
  ];
  const allContent = sources.map(f => f.content).join("\n");
  const secrets: { type: string; line: number }[] = [];
  const lines = allContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const p of secretPatterns) {
      const matches = lines[i].matchAll(p.pattern);
      for (const m of matches) { if (m.index !== undefined && !m[0].includes("test") && !m[0].includes("example")) secrets.push({ type: p.name, line: i + 1 }); }
    }
  }
  return { secretsFound: secrets.length, secrets: secrets.slice(0, 10), recommendation: secrets.length > 0 ? `Found ${secrets.length} potential secrets` : "No secrets detected" };
}

function displayReport(displayName: string, repoData: any, fileTree: string[], vibe: any, secrets: any) {
  const colorFor = (score: number) => score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;

  process.stdout.write(`  ${chalk.bold("Score:")}        ${colorFor(vibe.overall)(`${vibe.overall}/100`)}`);
  process.stdout.write(`  ${chalk.bold("Files:")}        ${fileTree.length}`);
  process.stdout.write(`  ${chalk.bold("Language:")}     ${repoData.language || "Unknown"}`);
  process.stdout.write(`  ${chalk.bold("Stars:")}        ${repoData.stargazers_count || 0}  ${chalk.dim(`| Forks: ${repoData.forks_count || 0} | Issues: ${repoData.open_issues_count || 0}`)}`);
  process.stdout.write(`  ${chalk.bold("Last push:")}    ${repoData.pushed_at ? new Date(repoData.pushed_at).toLocaleDateString() : "Unknown"}`);

  process.stdout.write(`\n  ${chalk.bold("┌─────────────┬──────┐")}`);
  const dims = [["Naming", vibe.namingScore], ["Modernity", vibe.modernityScore], ["Hygiene", vibe.hygieneScore], ["Config", vibe.configCoherence], ["Deps Fresh", vibe.dependencyFreshness]];
  for (const [label, score] of dims) {
    const bar = "█".repeat(Math.floor((score as number) / 10)) + "░".repeat(10 - Math.floor((score as number) / 10));
    process.stdout.write(`  ${chalk.bold("│")} ${(label as string).padEnd(11)} ${chalk.bold("│")} ${colorFor(score as number)(bar)} ${colorFor(score as number)(score as number)} ${chalk.bold("│")}`);
  }
  process.stdout.write(`  ${chalk.bold("└─────────────┴──────┘")}`);

  if (secrets.secretsFound > 0) {
    process.stdout.write(`\n  ${chalk.red.bold(`⚠ ${secrets.secretsFound} secret(s) detected:`)}`);
    for (const s of secrets.secrets.slice(0, 5)) process.stdout.write(`    ${chalk.red("●")} ${s.type} at line ${s.line}`);
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

  process.stdout.write(`\n  ${chalk.dim("─".repeat(46))}`);
  process.stdout.write(`  ${chalk.dim("Full report:")} ${chalk.cyan(`https://reporank.dev/report/${displayName}`)}`);
  process.stdout.write(`  ${chalk.dim("npx @reporank/cli scan --json ${displayName}")} ${chalk.dim("for machine-readable output")}`);
  process.stdout.write(`  ${chalk.dim("─".repeat(46))}`);
}
