import type { Command } from "commander";

type SonarQubeImportOptions = {
  profile?: string;
  issues?: string;
  qualityGate?: string;
  output?: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function normalizeOutputFormat(output?: string): "json" | "reporank-config" {
  if (!output || output === "json") return "json";
  if (output === "reporank-config") return "reporank-config";
  fail(`Invalid --output value "${output}". Expected "json" or "reporank-config".`);
}

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import external tool configurations into RepoRank format");

  importCmd
    .command("sonarqube")
    .description("Import SonarQube quality profile XML and issue report JSON")
    .option("--profile <path>", "Path to SonarQube quality profile XML file")
    .option("--issues <path>", "Path to SonarQube issue report JSON file")
    .option("--quality-gate <path>", "Path to SonarQube quality gate JSON file")
    .option("--output <format>", 'Output format: "json" (default) or "reporank-config"', "json")
    .action(async (opts: SonarQubeImportOptions) => {
      try {
        if (!opts.profile && !opts.issues && !opts.qualityGate) {
          fail(
            "At least one of --profile, --issues, or --quality-gate is required.\n" +
              "Usage: reporank import sonarqube --profile <path> [--issues <path>] [--quality-gate <path>]",
          );
        }

        const outputFormat = normalizeOutputFormat(opts.output);

        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const {
          parseQualityProfile,
          parseIssueReport,
          parseQualityGate,
          generateMigrationReport,
          generateRepoRankConfig,
        } = await import("@reporank/grading-engine");

        let profile: ReturnType<typeof parseQualityProfile> | null = null;
        let issueReport: ReturnType<typeof parseIssueReport> | null = null;
        let qualityGate: ReturnType<typeof parseQualityGate> | null = null;

        try {
          if (opts.profile) {
            const profilePath = resolve(opts.profile);
            const xmlContent = readFileSync(profilePath, "utf-8");
            profile = parseQualityProfile(xmlContent);
          }

          if (opts.issues) {
            const issuesPath = resolve(opts.issues);
            const jsonContent = readFileSync(issuesPath, "utf-8");
            issueReport = parseIssueReport(jsonContent);
          }

          if (opts.qualityGate) {
            const gatePath = resolve(opts.qualityGate);
            const gateContent = readFileSync(gatePath, "utf-8");
            qualityGate = parseQualityGate(gateContent);
          }
        } catch (err) {
          fail(`Error reading input file: ${(err as Error).message}`);
        }

        const report = generateMigrationReport(profile, issueReport?.issues ?? null, qualityGate);

        if (outputFormat === "reporank-config") {
          const config = generateRepoRankConfig(report);
          process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
          process.stderr.write(
            `Generated RepoRank config from ${report.totalRules} rule(s) and ${report.totalIssues} issue(s).\n`,
          );

          if (report.gaps.length > 0) {
            process.stderr.write(`Category gaps: ${report.gaps.join(", ")}\n`);
          }

          return;
        }

        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.stderr.write(`${report.summary}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Command failed: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
