#!/usr/bin/env node
/**
 * RepoRank CLI — Grade any GitHub repo from your terminal.
 * Usage: npx @reporank/cli scan <repo-url>
 *        npx @reporank/cli scan https://github.com/owner/repo
 *        npx @reporank/cli scan owner/repo
 */

import { Command } from "commander";
import { scanCommand } from "./scan.js";

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

program.parse(process.argv);
