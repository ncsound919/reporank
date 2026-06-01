import "dotenv/config";
import Bull from "bull";
import { fetchRepoData, repoDataToGradeInput } from "@reporank/grading-engine/scanners/github";
import { GradingService, runDeepAnalysis } from "@reporank/grading-engine";
import { analyzeVibe } from "@reporank/vibe-analyzer";
import { generateFixPacks } from "@reporank/fix-pack-generator";
import { buildRoadmap } from "@reporank/fix-pack-generator";
import { scanSecrets } from "@reporank/claw-protect-core";

const gradingService = new GradingService(process.env.GEMINI_API_KEY || "");

interface JobData { scanId: string; repoOwner: string; repoName: string; }

const queue = new Bull<JobData>("scan-jobs", process.env.REDIS_URL || "redis://localhost:6379");

queue.process(async (job) => {
  console.log(`Processing ${job.data.repoOwner}/${job.data.repoName}`);

  const repoData = await fetchRepoData(job.data.repoOwner, job.data.repoName);
  const input = repoDataToGradeInput(repoData);
  const vibe = analyzeVibe({ files: repoData.fileTree, sourceFiles: repoData.sourceFiles });

  const allContent = repoData.sourceFiles.map(f => f.content).join("\n");
  const clawResults = scanSecrets(allContent);

  // Run deep deterministic analyzers for real vibe-coder insights
  const deep = runDeepAnalysis(
    null, repoData.fileTree, repoData.sourceFiles, repoData.packageJson
  );

  const report = await gradingService.gradeRepo(input, {
    vibeAnalysis: vibe,
    clawSecrets: clawResults,
    deepAnalysis: deep.rawPromptBlock,
    topRecommendations: deep.topRecommendations,
  } as any);

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

  const fixPacks = generateFixPacks(report);
  const roadmap = buildRoadmap(report.quickWins, report.overallScore);
  report.roadmap = roadmap;

  report.overallScore = Math.round(
    report.dimensionScores.security * 0.25 + report.dimensionScores.quality * 0.20 +
    vibe.overall * 0.15 + report.dimensionScores.architecture * 0.15 +
    report.dimensionScores.deployment * 0.10 + report.dimensionScores.documentation * 0.05 +
    report.dimensionScores.license * 0.05 + report.dimensionScores.market * 0.05
  );

  console.log(`Complete: ${report.overallScore}/100 — ${report.gradeCategory}`);
  console.log(`Deep analysis: ${deep.worstFiles.length} hot files, ${deep.dependencies.findings.length} dep issues, ${deep.production.findings.length} production issues`);
  return { scanId: job.data.scanId, report, fixPacks, deepAnalysis: deep };
});

queue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

queue.on("error", (err) => {
  console.error("Queue error:", err.message);
});

console.log("Scanner worker ready.");
