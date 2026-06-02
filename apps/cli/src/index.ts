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

agents
  .command("generate")
  .description("Generate AGENTS.md for a directory")
  .argument("[directory]", "Directory to analyze (default: current)")
  .option("-m, --mode <mode>", "Output mode: minimal, standard, comprehensive (default: standard)")
  .option("-o, --output <file>", "File to write output to")
  .option("--json", "Output as JSON")
  .action(agentsGenerateCommand);

agents
  .command("audit")
  .description("Audit an existing AGENTS.md for compliance")
  .argument("<file>", "Path to AGENTS.md file")
  .option("--json", "Output as JSON")
  .action(agentsAuditCommand);

program.parse(process.argv);
