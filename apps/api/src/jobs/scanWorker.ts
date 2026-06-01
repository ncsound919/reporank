import { scanQueue } from "./queue";
import { prisma } from "../db/client";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/scanners/github";
import { GradingService, runDeepAnalysis } from "@reporank/grading-engine";
import { analyzeVibe } from "@reporank/vibe-analyzer";
import { generateFixPacks } from "@reporank/fix-pack-generator";
import { buildRoadmap } from "@reporank/fix-pack-generator";
import { scanSecrets } from "@reporank/claw-protect-core";
import { config } from "../config";

const gradingService = new GradingService(config.gemini.apiKey, config.gemini.model);

const SCORING_WEIGHTS = {
  security: 0.25,
  quality: 0.20,
  vibe: 0.15,
  architecture: 0.15,
  deployment: 0.10,
  documentation: 0.05,
  license: 0.05,
  market: 0.05,
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

export function startWorker() {
  scanQueue.process(async (job) => {
    const { scanId, repoOwner, repoName } = job.data;
    const startTime = Date.now();

    try {
      // Phase 1: Fetch
      await prisma.scan.update({ where: { id: scanId }, data: { status: "cloning", message: "Fetching repository data..." } });

      const repoData = await fetchRepoData(repoOwner, repoName, process.env.GITHUB_TOKEN);
      const input = repoDataToGradeInput(repoData);

      // Phase 2: Deterministic analysis (all run in parallel where possible)
      await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 25, message: "Running deep analysis..." } });

      const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });
      const allContent = repoData.sourceFiles.map(f => f.content).join("\n");
      const clawResults = scanSecrets(allContent);
      const deep = runDeepAnalysis(null, repoData.fileTree, repoData.sourceFiles, repoData.packageJson);

      await prisma.scan.update({ where: { id: scanId }, data: { status: "scanning", progress: 50, message: "Security and quality analysis complete..." } });

      // Phase 3: AI grading
      await prisma.scan.update({ where: { id: scanId }, data: { status: "grading", progress: 70, message: "AI is evaluating results..." } });

      const report = await gradingService.gradeRepo(input, {
        vibeAnalysis: vibe,
        clawSecrets: clawResults,
        deepAnalysis: deep.rawPromptBlock,
        topRecommendations: deep.topRecommendations,
      } as any);

      // Merge deterministic vibe into AI report
      report.vibe = {
        ...report.vibe,
        namingScore: vibe.namingScore,
        modernityScore: vibe.modernityScore,
        hygieneScore: vibe.hygieneScore,
        configCoherence: vibe.configCoherence,
        dependencyFreshness: vibe.dependencyFreshness,
        overall: vibe.overall,
        recommendations: [...new Set([...vibe.recommendations, ...(report.vibe.recommendations || [])])],
      };

      // Generate fix packs and roadmap
      const fixPacks = generateFixPacks(report);
      report.roadmap = buildRoadmap(report.quickWins, report.overallScore);

      // Recalculate weighted overall score with deterministic vibe
      report.overallScore = calcOverall(report, vibe.overall);

      // Phase 4: Save results
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete",
          progress: 100,
          overallScore: report.overallScore,
          gradeCategory: report.gradeCategory,
          maturityLevel: report.maturityLevel,
          vibeScore: vibe.overall,
          report: report as any,
          fixPack: fixPacks as any,
          completedAt: new Date(),
          duration: Math.floor((Date.now() - startTime) / 1000),
        },
      });

      console.log(`Scan ${scanId} complete: ${report.overallScore}/100 — ${report.gradeCategory}`);

    } catch (err: any) {
      // Phase 5: Write error state
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: "error", errorMessage: err.message, completedAt: new Date() },
      }).catch(e => console.error("Failed to update scan error:", e));

      throw err; // Re-throw so Bull knows the job failed
    }
  });

  scanQueue.on("failed", (job, err) => {
    console.error(`Job ${job.id} failed:`, err.message);
  });

  scanQueue.on("error", (err) => {
    console.error("Queue error:", err.message);
  });

  console.log("Worker started, processing scan jobs...");
}
