import { scanQueue } from "./queue";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { ScanStatus } from "../constants";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/scanners/github";
import {
  GradingService,
  runDeepAnalysis,
  buildGradingPrompt,
  parseHealthReport,
  gradeRepoStatic,
  emptySecurityGroup,
  type SecurityGroup,
} from "@reporank/grading-engine";
import { runNovelAnalysis } from "@reporank/grading-engine/novel";
import { generateUnstickPlan } from "@reporank/grading-engine/unstick";
import { detectInvisibleBugs } from "@reporank/grading-engine/invisible-bugs";
import { createProvider } from "@reporank/grading-engine/providers";
import { analyzeVibe } from "@reporank/vibe-analyzer";
import { generateFixPacks } from "@reporank/fix-pack-generator";
import { buildRoadmap } from "@reporank/fix-pack-generator";
import { scanSecrets } from "@reporank/claw-protect-core";
import { config } from "../config";
import { reportFingerprint, type AuditReport } from "@overlay365/audit-core";
import { auditLocalFiles, auditRemoteRepo } from "../services/measuredAudit";

const gradingService = new GradingService();

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
        await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.CLONING, message: "Processing uploaded files..." } });
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
        await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.CLONING, message: "Fetching repository data..." } });
        repoData = await fetchRepoData(repoOwner, repoName, config.github.token);
        input = repoDataToGradeInput(repoData);
      }

      await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.SCANNING, progress: 25, message: "Running deep analysis..." } });

      // Phase 2: Deterministic analysis (runs for all modes)
      const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });
      const allContent = repoData.sourceFiles.map((f: any) => f.content).join("\n");
      const clawResults = scanSecrets(allContent);
      const deep = runDeepAnalysis(null, repoData.fileTree, repoData.sourceFiles, repoData.packageJson);

      // Phase 2b: measured security audit (real tools, provenance-tagged).
      // Replaces the old inline scanner block; findings now feed the score.
      let security: SecurityGroup = emptySecurityGroup("audit disabled");
      let auditReport: AuditReport | null = null;
      if (config.audit.enabled) {
        await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.SCANNING, progress: 50, message: "Running measured security audit..." } });
        const auditOpts = {
          timeoutMs: config.audit.timeoutMs,
          gitHistory: config.audit.gitHistory,
          codeqlBuild: config.audit.codeqlBuild,
          toolsDir: config.audit.toolsDir,
        };
        const measured = isLocal
          ? await auditLocalFiles(localFiles!, auditOpts)
          : await auditRemoteRepo(input.repoOwner, input.repoName, auditOpts);
        security = measured.group;
        auditReport = measured.report;
        logger.info(
          { scanId, findings: security.summary.total, tools: security.summary.tools, excluded: security.summary.excluded.length },
          "Measured audit complete",
        );
      }

      // Novel analysis: architecture diagrams, tech debt, dead code, README
      const novel = runNovelAnalysis(
        repoData.sourceFiles, repoData.fileTree,
        deep.codeHygiene?.findings || [],
        deep.production?.findings || [],
        clawResults.secretsFound,
        vibe.overall,
        input.repoName, input.repoOwner, "", "",
        input.mainLanguage, input.mainLanguage,
        [], [],
      );

      // Phase 3: AI grading (skipped in private mode, supports multiple providers)
      let report: any;
      const isPrivate = privateMode === true;

      if (isPrivate) {
        // Private mode: deterministic-only, generate a basic report
        report = buildPrivateReport(input, vibe, deep, clawResults);
      } else {
        await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.GRADING, progress: 75, message: "AI is evaluating results..." } });

        // Use specified AI provider, or default from config
        const providerType = aiProvider || config.localAi.provider;
        const model = aiModel || config.localAi.model || undefined;
        const endpoint = aiEndpoint || config.localAi.endpoint || undefined;

        if (providerType === "gemini") {
          report = await gradingService.gradeRepo(input, {
            vibeAnalysis: vibe, clawSecrets: clawResults, deepAnalysis: deep.rawPromptBlock,
            topRecommendations: deep.topRecommendations, measuredSecurity: security.summary,
          } as any);
        } else {
          // Local AI provider (Ollama, LM Studio)
          const provider = createProvider(providerType, config.gemini.apiKey, model, endpoint);
          const prompt = buildGradingPrompt(input, {
            vibeAnalysis: vibe, clawSecrets: clawResults, deepAnalysis: deep.rawPromptBlock,
            topRecommendations: deep.topRecommendations, measuredSecurity: security.summary,
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

      // Official score is deterministic + measured. LLM dimension scores remain
      // narrative only and never determine the headline number.
      const staticReport = gradeRepoStatic(input, { ...deep, security });
      report.overallScore = staticReport.staticScore;
      report.staticScore = staticReport.staticScore;
      report.scoreBasis = "measured+deterministic";
      report.measuredSecurity = security.summary;
      report.auditFingerprint = auditReport ? reportFingerprint(auditReport) : null;
      report.worstFiles = staticReport.worstFiles;

      const fixPacks = generateFixPacks(report);
      report.roadmap = buildRoadmap(report.quickWins, report.overallScore);

      // Generate unstick plan from full report data
      const unstick = generateUnstickPlan(
        report.overallScore, report.dimensionScores, report.quickWins,
        report.bugsAndLeaks || [], report.structuralSmells || [],
        report.hallucinatedFeatures || [], report.vibe,
        report.deployment, report.license, report.security,
        true,
      );

      // Invisible bugs — patterns even senior devs miss
      const invisible = detectInvisibleBugs(repoData.sourceFiles || []);

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: ScanStatus.COMPLETE, progress: 100,
          overallScore: report.overallScore, gradeCategory: report.gradeCategory,
          maturityLevel: report.maturityLevel, vibeScore: vibe.overall,
          report: report as any, fixPack: fixPacks as any,
          clawFindings: {
            critical: security.summary.bySeverity.critical,
            high: security.summary.bySeverity.high,
            medium: security.summary.bySeverity.medium,
            low: security.summary.bySeverity.low,
            secrets: clawResults,
            security,
            audit: auditReport,
            private: isPrivate,
            novel,
            unstick,
            invisible,
          } as any,
          completedAt: new Date(), duration: Math.floor((Date.now() - startTime) / 1000),
        },
      });

      logger.info({ scanId, score: report.overallScore, grade: report.gradeCategory, private: isPrivate }, "Scan complete");

    } catch (err: any) {
      await prisma.scan.update({
        where: { id: scanId }, data: { status: ScanStatus.ERROR, errorMessage: err.message, completedAt: new Date() },
      }).catch((e: any) => logger.error(e, "Failed to update scan error"));
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
