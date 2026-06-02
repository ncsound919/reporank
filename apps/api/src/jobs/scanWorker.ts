import { scanQueue } from "./queue";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/scanners/github";
import { GradingService, runDeepAnalysis } from "@reporank/grading-engine";
import { createProvider } from "@reporank/grading-engine/providers";
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
    const { scanId, repoOwner, repoName, localFiles, privateMode, aiProvider, aiModel, aiEndpoint } = job.data;
    const isLocal = localFiles && localFiles.length > 0;
    const startTime = Date.now();

    try {
      // Phase 1: Fetch or receive data
      let repoData: any;
      let input: any;

      if (isLocal) {
        await prisma.scan.update({ where: { id: scanId }, data: { status: "cloning", message: "Processing uploaded files..." } });
        const files = localFiles!;
        const fileTree = files.map(f => f.path);
        const srcExts = new Set([".ts",".tsx",".js",".jsx",".py",".go",".rs",".java",".rb",".php",".css",".html",".json",".md",".yaml",".yml"]);
        const sourceFiles = files.filter(f => srcExts.has(f.path.slice(f.path.lastIndexOf("."))));
        const packageJsonFile = files.find(f => f.path === "package.json");
        repoData = { fileTree, sourceFiles, packageJson: packageJsonFile?.content || "{}" };
        input = {
          repoUrl: "local", repoName: repoName || "local-project", repoOwner: repoOwner,
          mainLanguage: "Mixed", starsCount: 0, forksCount: 0, openIssuesCount: 0,
          lastPushedAt: new Date().toISOString(),
          readmeContent: files.find(f => f.path.toLowerCase() === "readme.md")?.content || "",
          packageJson: packageJsonFile?.content || "{}",
          fileTree, sourceFiles,
        };
      } else {
        await prisma.scan.update({ where: { id: scanId }, data: { status: "cloning", message: "Fetching repository data..." } });
        repoData = await fetchRepoData(repoOwner, repoName, config.github.token);
        input = repoDataToGradeInput(repoData);
      }

      await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 25, message: "Running deep analysis..." } });

      // Phase 2: Deterministic analysis (runs for all modes)
      const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });
      const allContent = repoData.sourceFiles.map((f: any) => f.content).join("\n");
      const clawResults = scanSecrets(allContent);
      const deep = runDeepAnalysis(null, repoData.fileTree, repoData.sourceFiles, repoData.packageJson);

      let scannerResults: Record<string, any> = {};
      if (config.deepScan) {
        await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 50, message: "Running deep scanners..." } });
        if (!isLocal && input.repoUrl !== "local") {
          scannerResults = await runDeepScanners(`${input.repoUrl}.git`);
        }
      }

      // Phase 3: AI grading (skipped in private mode, supports multiple providers)
      let report: any;
      const isPrivate = privateMode === true;

      if (isPrivate) {
        // Private mode: deterministic-only, generate a basic report
        report = buildPrivateReport(input, vibe, deep, clawResults);
      } else {
        await prisma.scan.update({ where: { id: scanId }, data: { status: "grading", progress: 75, message: "AI is evaluating results..." } });

        // Use specified AI provider, or default from config
        const providerType = aiProvider || config.localAi.provider;
        const model = aiModel || config.localAi.model || undefined;
        const endpoint = aiEndpoint || config.localAi.endpoint || undefined;

        if (providerType === "gemini") {
          report = await gradingService.gradeRepo(input, {
            vibeAnalysis: vibe, clawSecrets: clawResults, deepAnalysis: deep.rawPromptBlock,
            topRecommendations: deep.topRecommendations, ...scannerResults,
          } as any);
        } else {
          // Local AI provider (Ollama, LM Studio)
          const provider = createProvider(providerType, config.gemini.apiKey, model, endpoint);
          const { buildGradingPrompt, parseHealthReport } = await import("@reporank/grading-engine");
          const prompt = buildGradingPrompt(input, {
            vibeAnalysis: vibe, clawSecrets: clawResults, deepAnalysis: deep.rawPromptBlock,
            topRecommendations: deep.topRecommendations, ...scannerResults,
          } as any);
          const rawResponse = await provider.generate(prompt);
          report = parseHealthReport(rawResponse);
          report.repoOwner = input.repoOwner;
          report.repoName = input.repoName;
          report.mainLanguage = input.mainLanguage;
          report.starsCount = input.starsCount;
          report.forksCount = input.forksCount;
          report.openIssuesCount = input.openIssuesCount;
          report.lastPushedAt = input.lastPushedAt;
          report.scannedAt = new Date().toISOString();
        }
      }

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
          clawFindings: { secrets: clawResults, scanners: scannerResults, private: isPrivate } as any,
          completedAt: new Date(), duration: Math.floor((Date.now() - startTime) / 1000),
        },
      });

      logger.info({ scanId, score: report.overallScore, grade: report.gradeCategory, private: isPrivate }, "Scan complete");

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

function buildPrivateReport(input: any, vibe: any, deep: any, clawResults: any): any {
  return {
    repoOwner: input.repoOwner, repoName: input.repoName, mainLanguage: input.mainLanguage,
    starsCount: 0, forksCount: 0, openIssuesCount: 0,
    lastPushedAt: new Date().toISOString(), scannedAt: new Date().toISOString(),
    overallScore: vibe.overall,
    gradeCategory: vibe.overall >= 80 ? "B+" : vibe.overall >= 60 ? "C" : vibe.overall >= 40 ? "D" : "F",
    maturityLevel: vibe.overall >= 80 ? "Production" : vibe.overall >= 60 ? "Beta" : "MVP",
    summary: "Private mode analysis (deterministic only). No AI grading performed.",
    dimensionScores: {
      security: Math.max(0, 100 - clawResults.secretsFound * 10),
      quality: 60, vibe: vibe.overall, architecture: deep.complexity.fileSizeDistribution.xlarge > 0 ? 40 : 70,
      deployment: 50, documentation: 50, license: 50, market: 50,
    },
    security: { secretsFound: clawResults.secretsFound, secretsCritical: 0, vulnerabilityCount: 0, highestSeverity: "medium", vulnerabilities: [], dependencyCves: 0, hasSastScan: false, score: Math.max(0, 100 - clawResults.secretsFound * 10) },
    quality: { readmeScore: 50, testFramework: null, testFileCount: 0, codeSmells: 0, duplicationPercent: 0, hasLintConfig: false, hasCiConfig: false, score: 60 },
    vibe,
    architecture: { couplingScore: 50, circularImportsCount: 0, complexityRating: "medium", fileCount: input.fileTree?.length || 0, avgFileLength: 100, score: 50 },
    deployment: { hasDockerfile: false, dockerfileScore: 0, hasCIConfig: false, hasEnvExample: false, hasHealthcheck: false, hasLogging: false, loggingFramework: null, score: 50 },
    documentation: { readmeCompleteness: 50, hasSetupInstructions: false, hasApiDocs: false, hasArchitectureDiagram: false, hasContributingGuide: false, hasLicenseFile: false, score: 50 },
    license: { licenseType: null, isCopyleft: false, licenseConflicts: [], hasLicenseFile: false, score: 50 },
    market: { trendAlignment: "steady", percentileRank: 50, competitorCount: 0, recentActivity: "active", score: 50 },
    valuation: { replacementCostFMV: 0, reliefFromRoyaltyValue: 0, productivityWasteHeuristic: 0 },
    hallucinatedFeatures: [],
    bugsAndLeaks: deep.codeHygiene?.findings?.slice(0, 10).map((f: any) => `${f.filePath}${f.line ? ":" + f.line : ""} — ${f.detail}`) || [],
    structuralSmells: deep.complexity.hotSpots?.slice(0, 5).map((h: any) => h.detail) || [],
    quickWins: [
      ...(clawResults.secretsFound > 0 ? [{ title: "Review exposed secrets", severity: "critical" as const, category: "Security", effort: "hours" as const, description: `${clawResults.secretsFound} secrets detected — review and rotate immediately`, action: "Remove secrets from code, use .env" }] : []),
      ...(deep.codeHygiene?.findings?.filter((f: any) => f.severity === "critical" || f.severity === "high").slice(0, 5).map((f: any) => ({ title: f.detail.slice(0, 60), severity: f.severity as any, category: "Code Quality", effort: "hours" as const, description: f.detail, action: f.fixSuggestion || "" })) || []),
    ],
    roadmap: [], implementationPlan: [],
    globalBenchmarkPercent: 50,
  };
}
