/**
 * Deep pipeline test — finds the real problems a vibe coder needs to fix.
 * Runs: file complexity, dep health, architecture coherence, production readiness,
 *       vibe analysis, secrets scanning, fix pack generation.
 * Target: Claw Protect repo
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

const CLAW_PATH = "C:\\Users\\User\\Desktop\\Vibe-Reality-main\\Claw-Protect-main";
const RESULTS = [];

function print(msg = "") { console.log(msg); RESULTS.push(msg); }
function section(title) {
  print(`\n${"═".repeat(78)}`);
  print(`  ${title}`);
  print(`${"═".repeat(78)}`);
}

// ─── GATHER DATA ──────────────────────────────────────────────────────
section("📂 SCANNING: Claw Protect Repository");

const allFiles = [];
function walkDir(dir, prefix = "") {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walkDir(full, rel);
    else if (e.isFile()) allFiles.push(rel);
  }
}
walkDir(CLAW_PATH);

const srcExts = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yaml", ".yml"]);
const sourceFiles = allFiles.filter(f => srcExts.has(extname(f))).slice(0, 60).map(fp => {
  try { return { path: fp, content: readFileSync(join(CLAW_PATH, fp), "utf-8") }; }
  catch { return { path: fp, content: "" }; }
}).filter(f => f.content);

const packageJsonContent = sourceFiles.find(f => f.path === "package.json")?.content || "{}";

print(`  Files found: ${allFiles.length}`);
print(`  Source files read: ${sourceFiles.length}`);

// ─── IMPORT ANALYZERS ─────────────────────────────────────────────────
const { analyzeComplexity } = await import("../packages/grading-engine/src/analyzers/complexity.ts");
const { analyzeDependencies } = await import("../packages/grading-engine/src/analyzers/dependency-health.ts");
const { analyzeArchitecture } = await import("../packages/grading-engine/src/analyzers/architecture.ts");
const { analyzeProductionReadiness } = await import("../packages/grading-engine/src/analyzers/production.ts");
const { runDeepAnalysis } = await import("../packages/grading-engine/src/analyzers/index.ts");
const { analyzeVibe } = await import("../packages/vibe-analyzer/src/index.ts");
const { scanSecrets } = await import("../packages/claw-protect-core/src/secretsScanner.ts");
const { generateFixPacks } = await import("../packages/fix-pack-generator/src/patchBuilder.ts");
const { buildRoadmap } = await import("../packages/fix-pack-generator/src/roadmapBuilder.ts");

// ─── 1. FILE COMPLEXITY ANALYSIS ──────────────────────────────────────
section("🔴 FILE COMPLEXITY — The Files That Will Bite You");

const complexity = analyzeComplexity(CLAW_PATH, sourceFiles);

print(`\n  Size Distribution:`);
print(`    📄 Small (<100 lines):  ${complexity.fileSizeDistribution.small}`);
print(`    📄 Medium (100-300):     ${complexity.fileSizeDistribution.medium}`);
print(`    📄 Large (300-600):      ${complexity.fileSizeDistribution.large}`);
print(`    📄 X-Large (>600 lines): ${complexity.fileSizeDistribution.xlarge}`);

if (complexity.worstFiles.length > 0) {
  print(`\n  🔴 WORST FILES (need immediate attention):`);
  for (const f of complexity.worstFiles) {
    print(`    SCORE ${f.score}: ${f.path}`);
    for (const r of f.reasons) print(`           → ${r}`);
  }
}

if (complexity.hotSpots.length > 0) {
  print(`\n  ⚠️  HOT SPOTS:`);
  for (const h of complexity.hotSpots) {
    const icon = h.severity === "critical" ? "🔴" : h.severity === "high" ? "⚠️" : "🔶";
    print(`    ${icon} [${h.severity.toUpperCase()}] ${h.filePath}`);
    print(`       ${h.detail}`);
  }
}

if (complexity.cohesionViolations.length > 0) {
  print(`\n  📁 COHESION VIOLATIONS:`);
  for (const v of complexity.cohesionViolations) print(`    → ${v}`);
}

// ─── 2. DEPENDENCY HEALTH ─────────────────────────────────────────────
section("📦 DEPENDENCY HEALTH — What's Rotting");

const deps = analyzeDependencies(packageJsonContent, sourceFiles);

print(`\n  Summary: ${deps.totalDeps} prod + ${deps.devDeps} dev deps | Health: ${deps.depHealthScore}/100`);

const bySeverity = (sev) => deps.findings.filter(f => f.severity === sev);
if (bySeverity("critical").length > 0) {
  print(`\n  🔴 CRITICAL:`);
  for (const f of bySeverity("critical")) print(`    ${f.packageName}@${f.version} — ${f.detail}`);
}
if (bySeverity("high").length > 0) {
  print(`\n  ⚠️  HIGH:`);
  for (const f of bySeverity("high")) print(`    ${f.packageName}@${f.version} — ${f.detail}`);
}
if (bySeverity("medium").length > 0) {
  print(`\n  🔶 MEDIUM:`);
  for (const f of bySeverity("medium")) print(`    ${f.packageName} — ${f.detail}`);
}
if (deps.unusedPatterns.length > 0) {
  print(`\n  🗑️  UNUSED (declared but never imported):`);
  for (const u of deps.unusedPatterns) print(`    → ${u}`);
}

// ─── 3. ARCHITECTURE ANALYSIS ─────────────────────────────────────────
section("🏗️  ARCHITECTURE — Structure Problems");

const arch = analyzeArchitecture(allFiles, sourceFiles);

print(`\n  Detected archetype: ${arch.summary.split(".")[0]}`);

if (arch.findings.length > 0) {
  print(`\n  Issues found: ${arch.findings.length}`);
  for (const f of arch.findings) {
    const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "⚠️" : f.severity === "medium" ? "🔶" : "💡";
    print(`    ${icon} [${f.type}] ${f.filePath}`);
    print(`       ${f.detail}`);
  }
}

print(`\n  Directory layout:`);
for (const d of arch.directoryBreakdown.slice(0, 8)) {
  print(`    📁 ${d.dir}/ — ${d.fileCount} files (${d.description})`);
}

// ─── 4. PRODUCTION READINESS ─────────────────────────────────────────
section("🚀 PRODUCTION READINESS — What Breaks at 2am");

const prod = analyzeProductionReadiness(sourceFiles, allFiles);

const readinessIcons = { ready: "✅", "needs-work": "⚠️", "not-ready": "🔴" };
print(`\n  Overall: ${readinessIcons[prod.overallReadiness]} ${prod.overallReadiness}`);

if (prod.deployBlockers.length > 0) {
  print(`\n  🔴 DEPLOY BLOCKERS:`);
  for (const b of prod.deployBlockers) {
    print(`    ${b.detail}`);
    print(`    Fix: ${b.fixSuggestion}`);
  }
}

if (prod.findings.length > 0) {
  print(`\n  Issues: ${prod.findings.length}`);
  for (const f of prod.findings) {
    const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "⚠️" : "🔶";
    print(`    ${icon} [${f.type}] ${f.filePath}`);
    print(`       ${f.detail}`);
    print(`       → Fix: ${f.fixSuggestion}`);
  }
}

// ─── 5. VIBE ANALYSIS ────────────────────────────────────────────────
section("🎨 VIBE ANALYSIS — Code Aesthetics & Hygiene");

const vibe = analyzeVibe({ files: allFiles, sourceFiles });

print(`\n  OVERALL VIBE: ${vibe.overall}/100`);
print(`  ┌─────────────┬──────┐`);
const bars = [
  ["Naming", vibe.namingScore],
  ["Modernity", vibe.modernityScore],
  ["Hygiene", vibe.hygieneScore],
  ["Config", vibe.configCoherence],
  ["Deps Fresh", vibe.dependencyFreshness],
];
for (const [label, score] of bars) {
  const bar = "█".repeat(Math.floor(score / 10)) + "░".repeat(10 - Math.floor(score / 10));
  print(`  │ ${label.padEnd(11)} │ ${bar} ${score} │`);
}
print(`  └─────────────┴──────┘`);

if (vibe.recommendations.length > 0) {
  print(`\n  Recommendations:`);
  for (const r of vibe.recommendations) print(`    → ${r}`);
}

// ─── 6. SECURITY SCAN ─────────────────────────────────────────────────
section("🔒 SECURITY SCAN — Exposed Secrets");

const allContent = sourceFiles.map(f => f.content).join("\n");
const secrets = scanSecrets(allContent);

if (secrets.secretsFound > 0) {
  print(`\n  🔴 ${secrets.secretsFound} SECRET(S) FOUND:`);
  for (const s of secrets.secrets) {
    print(`    ⚠️  ${s.type} at line ${s.line}: ${s.redacted}`);
  }
  print(`\n  ${secrets.recommendation}`);
} else {
  print(`\n  ✅ No secrets detected`);
}

// ─── 7. FIX PACKS ────────────────────────────────────────────────────
section("📦 AUTO-GENERATED FIX PACKS");

// Build mock report using real analysis data
const mockReport = {
  repoOwner: "claw", repoName: "Claw-Protect", overallScore: vibe.overall,
  gradeCategory: vibe.overall >= 80 ? "B+" : "C", maturityLevel: "Beta",
  mainLanguage: "TypeScript", starsCount: 0, forksCount: 0, openIssuesCount: 0,
  lastPushedAt: new Date().toISOString(), summary: "",
  dimensionScores: { security: 50, quality: 60, vibe: vibe.overall, architecture: 55, deployment: 40, documentation: 50, license: 50, market: 30 },
  security: { secretsFound: secrets.secretsFound, secretsCritical: 0, vulnerabilityCount: 0, highestSeverity: "medium", vulnerabilities: [], dependencyCves: 0, hasSastScan: false, score: 60 },
  quality: { readmeScore: 60, testFramework: null, testFileCount: 0, codeSmells: 8, duplicationPercent: 3, hasLintConfig: true, hasCiConfig: true, score: 60 },
  vibe,
  architecture: { couplingScore: 55, circularImportsCount: 0, complexityRating: "medium", fileCount: allFiles.length, avgFileLength: 180, score: 55 },
  deployment: { hasDockerfile: true, dockerfileScore: 70, hasCIConfig: true, hasEnvExample: false, hasHealthcheck: false, hasLogging: false, loggingFramework: null, score: 40 },
  documentation: { readmeCompleteness: 50, hasSetupInstructions: true, hasApiDocs: true, hasArchitectureDiagram: true, hasContributingGuide: false, hasLicenseFile: true, score: 50 },
  license: { licenseType: null, isCopyleft: false, licenseConflicts: [], hasLicenseFile: false, score: 50 },
  market: { trendAlignment: "steady", percentileRank: 30, competitorCount: 0, recentActivity: "active", score: 30 },
  valuation: { replacementCostFMV: 0, reliefFromRoyaltyValue: 0, productivityWasteHeuristic: 0 },
  hallucinatedFeatures: [], bugsAndLeaks: [], structuralSmells: [],
  quickWins: [], roadmap: [], implementationPlan: [], globalBenchmarkPercent: 0, scannedAt: new Date().toISOString(),
};

// Generate fix packs from actual deep analysis findings
const fixPacks = generateFixPacks(mockReport);
print(`\n  Standard fix packs: ${fixPacks.length} (Claw already has Dockerfile/CI/env-example)`);

// ─── 8. FULL DEEP ANALYSIS REPORT ─────────────────────────────────────
section("🧠 DEEP ANALYSIS — Full Aggregate Report");

const deep = runDeepAnalysis(CLAW_PATH, allFiles, sourceFiles, packageJsonContent);

print(`\n  🏆 TOP 10 RECOMMENDATIONS:`);
for (let i = 0; i < deep.topRecommendations.length; i++) {
  print(`  ${i + 1}. ${deep.topRecommendations[i]}`);
}

// ─── FINAL SUMMARY ────────────────────────────────────────────────────
section("📊 EXECUTIVE SUMMARY");

const criticalCount = complexity.hotSpots.filter(h => h.severity === "critical").length +
  deps.findings.filter(f => f.severity === "critical").length +
  arch.findings.filter(f => f.severity === "critical").length +
  prod.findings.filter(f => f.severity === "critical").length;

const highCount = complexity.hotSpots.filter(h => h.severity === "high").length +
  deps.findings.filter(f => f.severity === "high").length +
  arch.findings.filter(f => f.severity === "high").length +
  prod.findings.filter(f => f.severity === "high").length;

const geminiKey = process.env.GEMINI_API_KEY;

print(`
  ┌─────────────────────────────────────────────────────────────┐
  │  REPORANK — Claw Protect Deep Analysis                      │
  ├─────────────────────────────────────────────────────────────┤
  │  📂 ${allFiles.length} files  │  ${sourceFiles.length} source files analyzed      │
  │  🎨 Vibe Score: ${vibe.overall}/100                         │
  │  🔴 Critical issues: ${criticalCount}                               │
  │  ⚠️  High issues: ${highCount}                                 │
  │  🚀 Production: ${prod.overallReadiness}                              │
  │  📦 Dependencies: ${deps.totalDeps} prod, ${deps.depHealthScore}/100 health          │
  │  🔒 Secrets found: ${secrets.secretsFound}                              │
  ├─────────────────────────────────────────────────────────────┤
  │  TOP ACTIONS:                                               │`);

for (const rec of deep.topRecommendations.slice(0, 5)) {
  print(`  │  ${rec.padEnd(59)} │`);
}

print(`  └─────────────────────────────────────────────────────────────┘`);

if (geminiKey) {
  print(`\n  ✅ AI grading available (GEMINI_API_KEY set)`);
} else {
  print(`\n  ⏭️  AI grading skipped — set GEMINI_API_KEY for LLM-powered analysis`);
}

print(`\n  Full details above.`);
