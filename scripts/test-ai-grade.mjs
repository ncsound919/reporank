/**
 * AI-powered grading with deep analysis context.
 * Runs GradingService with all deep analyzer results injected into the prompt.
 */
import { readFileSync, readdirSync } from "fs";
import { join, extname } from "path";

const CLAW_PATH = "C:\\Users\\User\\Desktop\\Vibe-Reality-main\\Claw-Protect-main";

// Gather data
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

const srcExts = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md"]);
const sourceFiles = allFiles.filter(f => srcExts.has(extname(f))).slice(0, 60).map(fp => {
  try { return { path: fp, content: readFileSync(join(CLAW_PATH, fp), "utf-8") }; }
  catch { return { path: fp, content: "" }; }
}).filter(f => f.content);

const packageJsonContent = sourceFiles.find(f => f.path === "package.json")?.content || "{}";
const readmeContent = sourceFiles.find(f => f.path === "README.md")?.content || "";

// Import engines
const { GradingService } = await import("../packages/grading-engine/src/index.ts");
const { runDeepAnalysis } = await import("../packages/grading-engine/src/analyzers/index.ts");
const { runEnterpriseAnalysis } = await import("../packages/grading-engine/src/analyzers/enterprise.ts");
const { scanCodeHygiene } = await import("../packages/grading-engine/src/analyzers/code-hygiene.ts");
const { analyzeVibe } = await import("../packages/vibe-analyzer/src/index.ts");

const vibe = analyzeVibe({ files: allFiles, sourceFiles });
const deep = runDeepAnalysis(CLAW_PATH, allFiles, sourceFiles, packageJsonContent);
const enterprise = runEnterpriseAnalysis(allFiles, sourceFiles);
const hygiene = scanCodeHygiene(sourceFiles);

const gradeInput = {
  repoUrl: "https://github.com/user/Claw-Protect",
  repoName: "Claw-Protect",
  repoOwner: "user",
  mainLanguage: "TypeScript",
  starsCount: 0, forksCount: 0, openIssuesCount: 0,
  lastPushedAt: new Date().toISOString(),
  readmeContent: readmeContent.slice(0, 10000),
  packageJson: packageJsonContent.slice(0, 5000),
  fileTree: allFiles.slice(0, 100),
  sourceFiles: sourceFiles.slice(0, 15).map(f => ({ path: f.path, content: f.content.slice(0, 10000) })),
};

const grader = new GradingService(process.env.GEMINI_API_KEY || "");

console.log("🤖 Calling Gemini AI with deep analysis context...\n");

try {
  const report = await grader.gradeRepo(gradeInput, {
    vibeAnalysis: vibe,
    deepAnalysis: deep.rawPromptBlock + "\n" + enterprise.rawPromptBlock + `\n[Code Hygiene]\n${hygiene.findings.slice(0, 20).map(f => `  - ${f.severity.toUpperCase()}: ${f.detail} (${f.filePath}:${f.line || "?"})`).join("\n")}\n  Fix suggestion: ${hygiene.findings[0]?.fixSuggestion || "N/A"}`,
  });

  console.log("═".repeat(78));
  console.log("  REPORANK AI-GENERATED REPORT");
  console.log("═".repeat(78));
  console.log(`\n  OVERALL: ${report.overallScore}/100 — ${report.gradeCategory} (${report.maturityLevel})`);
  console.log(`  Summary: ${report.summary}\n`);

  console.log("  DIMENSION BREAKDOWN:");
  const dims = report.dimensionScores;
  console.log(`    Security:     ${dims.security}/100`);
  console.log(`    Quality:      ${dims.quality}/100`);
  console.log(`    Vibe:         ${dims.vibe}/100`);
  console.log(`    Architecture: ${dims.architecture}/100`);
  console.log(`    Deployment:   ${dims.deployment}/100`);
  console.log(`    Docs:         ${dims.documentation}/100`);
  console.log(`    License:      ${dims.license}/100`);
  console.log(`    Market:       ${dims.market}/100`);

  if (report.hallucinatedFeatures.length > 0) {
    console.log(`\n  🌀 HALLUCINATED FEATURES (claimed but not implemented):`);
    for (const h of report.hallucinatedFeatures) console.log(`    → ${h}`);
  }

  if (report.bugsAndLeaks.length > 0) {
    console.log(`\n  🐛 BUGS & LEAKS:`);
    for (const b of report.bugsAndLeaks) console.log(`    → ${b}`);
  }

  if (report.structuralSmells.length > 0) {
    console.log(`\n  👃 STRUCTURAL SMELLS:`);
    for (const s of report.structuralSmells) console.log(`    → ${s}`);
  }

  if (report.quickWins.length > 0) {
    console.log(`\n  ⚡ QUICK WINS:`);
    for (const q of report.quickWins) {
      console.log(`    [${q.severity.toUpperCase()}] ${q.title} (${q.effort})`);
      console.log(`    ${q.description}`);
    }
  }

  if (report.implementationPlan.length > 0) {
    console.log(`\n  📋 IMPLEMENTATION PLAN:`);
    for (const step of report.implementationPlan) {
      console.log(`    ${step.title}`);
      console.log(`    ${step.description}`);
      console.log(`    Files: ${step.targetFiles.join(", ")}`);
    }
  }

  // Senior-dev enterprise analysis (deterministic, no AI needed)
  console.log(`\n${"═".repeat(78)}`);
  console.log("  🏢 ENTERPRISE READINESS — What Senior Devs Care About");
  console.log(`${"═".repeat(78)}`);
  console.log(`\n  Overall Enterprise Score: ${enterprise.overallSeniorScore}/100`);
  console.log(`  Critical blockers: ${enterprise.criticalBlockers.length}`);

  console.log(`\n  📡 API Contracts (${enterprise.apiContract.consistencyScore}/100):`);
  for (const f of enterprise.apiContract.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  🔍 Observability (${enterprise.observability.observabilityScore}/100):`);
  for (const f of enterprise.observability.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  🔧 Build & CI (${enterprise.buildCI.ciScore}/100):`);
  for (const f of enterprise.buildCI.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  🔗 Coupling (${enterprise.coupling.couplingScore}/100):`);
  for (const f of enterprise.coupling.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  ⚖️  License & Compliance (${enterprise.license.licenseScore}/100):`);
  for (const f of enterprise.license.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  📊 Long-term Debt (${enterprise.longTermDebt.debtScore}/100):`);
  for (const f of enterprise.longTermDebt.findings) {
    console.log(`    ${f.severity === "critical" ? "🔴" : "⚠️"} ${f.detail}`);
    console.log(`       ${f.seniorNote}`);
  }

  console.log(`\n  🧹 CODE HYGIENE — Basic Mistakes (${hygiene.score}/100):`);
  for (const f of hygiene.findings.slice(0, 15)) {
    const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "⚠️" : f.severity === "medium" ? "🔶" : "💡";
    console.log(`    ${icon} [${f.category}] ${f.filePath}${f.line ? `:${f.line}` : ""}`);
    console.log(`       ${f.detail}`);
    console.log(`       → ${f.fixSuggestion}`);
  }
  if (hygiene.findings.length > 15) console.log(`    ... and ${hygiene.findings.length - 15} more findings`);

  console.log("\n  ✅ AI grading + enterprise analysis + code hygiene complete");

} catch (e) {
  console.error("❌ AI grading failed:", e.message);
}

await grader.dispose();
