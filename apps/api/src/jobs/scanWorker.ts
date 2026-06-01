import { scanQueue } from "./queue";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/scanners/github";
import { GradingService, runDeepAnalysis } from "@reporank/grading-engine";
import { analyzeVibe } from "@reporank/vibe-analyzer";
import { generateFixPacks } from "@reporank/fix-pack-generator";
import { buildRoadmap } from "@reporank/fix-pack-generator";
import { scanSecrets } from "@reporank/claw-protect-core";
import { config } from "../config";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const gradingService = new GradingService(config.gemini.apiKey, config.gemini.model);

const SCORING_WEIGHTS = {
  security: 0.25, quality: 0.20, vibe: 0.15, architecture: 0.15,
  deployment: 0.10, documentation: 0.05, license: 0.05, market: 0.05,
};

function calcOverall(report: any, vibeOverall: number): number {
  return Math.round(
    report.dimensionScores.security * SCORING_WEIGHTS.security +
    report.dimensionScores.quality * SCORING_WEIGHTS.quality +
    vibeOverall * SCORING_WEIGHTS.vibe +
    report.dimensionScores.architecture * SCORING_WEIGHTS.architecture +
    report.dimensionScores.deployment * SCORING_WEIGHTS.deployment +
    report.dimensionScores.documentation * SCORING_WEIGHTS.documentation +
    report.dimensionScores.license * SCORING_WEIGHTS.license +
    report.dimensionScores.market * SCORING_WEIGHTS.market
  );
}

function parseJson(raw: string): any { try { return JSON.parse(raw); } catch { return raw; } }

function parseSarif(raw: string): any {
  try {
    const sarif = JSON.parse(raw);
    const findings: any[] = [];
    for (const run of sarif.runs || [])
      for (const r of run.results || [])
        findings.push({ checkId: r.ruleId, severity: r.properties?.severity || "WARNING", path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "", message: r.message?.text || "" });
    return findings;
  } catch { return raw; }
}

async function runDeepScanners(repoUrl: string): Promise<Record<string, any>> {
  const results: Record<string, any> = {};
  const tempDir = mkdtempSync(join(tmpdir(), "reporank-"));

  try {
    execSync(`git clone --depth 1 ${repoUrl} .`, { cwd: tempDir, encoding: "utf-8", timeout: 60000, stdio: "pipe" });

    const scanners: { name: string; cmd: string; args: string[]; parser?: (out: string) => any }[] = [
      { name: "semgrep", cmd: "semgrep", args: ["scan", "--sarif", "--no-rewrite-rule-ids", "--quiet"], parser: parseSarif },
      { name: "trivy", cmd: "trivy", args: ["filesystem", "--format", "json", "--quiet", "--no-progress", tempDir], parser: parseJson },
      { name: "trufflehog", cmd: "trufflehog", args: ["filesystem", "--json", "--no-update", tempDir], parser: parseJson },
      { name: "hadolint", cmd: "hadolint", args: ["Dockerfile", "--format", "json"], parser: parseJson },
    ];

    for (const scanner of scanners) {
      try {
        const out = execSync(`${scanner.cmd} ${scanner.args.join(" ")}`, { cwd: tempDir, encoding: "utf-8", maxBuffer: 10*1024*1024, timeout: 120000, stdio: "pipe" });
        results[scanner.name] = scanner.parser ? scanner.parser(out) : out;
      } catch (e: any) {
        logger.warn(`Scanner ${scanner.name} skipped: ${e.message?.slice(0, 80)}`);
      }
    }

    logger.info(`Deep scan complete: ${Object.keys(results).length}/${scanners.length} scanners ran`);
    return results;
  } catch (e: any) {
      logger.warn("Deep scan clone failed:", e.message);
    return {};
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup best effort */ }
  }
}

export function startWorker() {
  scanQueue.process(async (job) => {
    const { scanId, repoOwner, repoName } = job.data;
    const startTime = Date.now();

    try {
      await prisma.scan.update({ where: { id: scanId }, data: { status: "cloning", message: "Fetching repository data..." } });

      const repoData = await fetchRepoData(repoOwner, repoName, config.github.token);
      const input = repoDataToGradeInput(repoData);

      await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 25, message: "Running deep analysis..." } });

      const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });
      const allContent = repoData.sourceFiles.map(f => f.content).join("\n");
      const clawResults = scanSecrets(allContent);
      const deep = runDeepAnalysis(null, repoData.fileTree, repoData.sourceFiles, repoData.packageJson);

      // Deep scanners (optional, DEEP_SCAN=true)
      let scannerResults: Record<string, any> = {};
      if (config.deepScan) {
        await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 50, message: "Running deep scanners (Semgrep, Trivy, TruffleHog, Hadolint)..." } });
        scannerResults = await runDeepScanners(`${input.repoUrl}.git`);
        await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 70, message: `Deep scan complete: ${Object.keys(scannerResults).length} scanners ran` } });
      }

      await prisma.scan.update({ where: { id: scanId }, data: { status: "grading", progress: 75, message: "AI is evaluating results..." } });

      const report = await gradingService.gradeRepo(input, {
        vibeAnalysis: vibe,
        clawSecrets: clawResults,
        deepAnalysis: deep.rawPromptBlock,
        topRecommendations: deep.topRecommendations,
        ...scannerResults,
      } as any);

      report.vibe = {
        ...report.vibe,
        namingScore: vibe.namingScore, modernityScore: vibe.modernityScore, hygieneScore: vibe.hygieneScore,
        configCoherence: vibe.configCoherence, dependencyFreshness: vibe.dependencyFreshness,
        overall: vibe.overall,
        recommendations: [...new Set([...vibe.recommendations, ...(report.vibe.recommendations || [])])],
      };

      const fixPacks = generateFixPacks(report);
      report.roadmap = buildRoadmap(report.quickWins, report.overallScore);
      report.overallScore = calcOverall(report, vibe.overall);

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete", progress: 100,
          overallScore: report.overallScore, gradeCategory: report.gradeCategory,
          maturityLevel: report.maturityLevel, vibeScore: vibe.overall,
          report: report as any, fixPack: fixPacks as any,
          clawFindings: { secrets: clawResults, scanners: scannerResults } as any,
          completedAt: new Date(), duration: Math.floor((Date.now() - startTime) / 1000),
        },
      });

      logger.info(`Scan ${scanId} complete: ${report.overallScore}/100 — ${report.gradeCategory}`);

    } catch (err: any) {
      await prisma.scan.update({
        where: { id: scanId }, data: { status: "error", errorMessage: err.message, completedAt: new Date() },
      }).catch(e => logger.error(e, "Failed to update scan error"));
      throw err;
    }
  });

  scanQueue.on("failed", (job, err) => { logger.error(err, `Job ${job.id} failed`); });
  scanQueue.on("error", (err) => { logger.error(err, "Queue error"); });

  logger.info("Worker started, processing scan jobs...");
}
