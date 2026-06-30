import type { Command } from "commander";

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
    .option("--output <format>", "Output format: json (default) or reporank-config", "json")
    .action(async (opts: { profile?: string; issues?: string; qualityGate?: string; output: string }) => {
      try {
        if (!opts.profile && !opts.issues) {
          console.error("  Error: at least one of --profile or --issues is required.");
          console.error("  Usage: reporank import sonarqube --profile <path> [--issues <path>]");
          process.exit(1);
        }

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
          console.error("  Error reading input file:", (err as Error).message);
          process.exit(1);
        }

        const report = generateMigrationReport(
          profile,
          issueReport?.issues ?? null,
          qualityGate,
        );

        if (opts.output === "reporank-config") {
          const config = generateRepoRankConfig(report);
          process.stdout.write(JSON.stringify(config, null, 2));
          console.error(`\n  Generated RepoRank config from ${report.totalRules} rule(s) and ${report.totalIssues} issue(s).`);
          if (report.gaps.length > 0) {
            console.error(`  Category gaps: ${report.gaps.join(", ")}`);
          }
        } else {
          process.stdout.write(JSON.stringify(report, null, 2));
          console.error(`\n  ${report.summary}`);
        }
      } catch (err) {
        console.error("Command failed:", err);
        process.exit(1);
      }
    });
}
