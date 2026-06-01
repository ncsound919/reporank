import type { GradeInput, ScannerResults } from "./index";

export function buildGradingPrompt(input: GradeInput, scannerResults?: ScannerResults): string {
  const readmeTrimmed = input.readmeContent.slice(0, 10000);
  const packageJsonTrimmed = input.packageJson.slice(0, 5000);
  const fileList = input.fileTree.slice(0, 100).join("\n");

  return `You are an expert codebase auditor grading a GitHub repository.

## Repository Metadata
- Name: ${input.repoOwner}/${input.repoName}
- Language: ${input.mainLanguage}
- Stars: ${input.starsCount} | Forks: ${input.forksCount} | Issues: ${input.openIssuesCount}
- Last push: ${input.lastPushedAt}

## README (truncated)
${readmeTrimmed}

## package.json (truncated)
${packageJsonTrimmed}

## File Tree (top 100 files)
${fileList}

${scannerResults ? `## Scanner Results (authoritative)
${JSON.stringify(scannerResults, null, 2)}` : "## No scanner results available"}

## Task
Return ONLY valid JSON matching this schema. No markdown, no code fences, no extra text.

{
  "overallScore": 0-100,
  "gradeCategory": "A+"|"A"|"B+"|"B"|"C"|"D"|"F",
  "maturityLevel": "Prototype"|"MVP"|"Beta"|"Production"|"Enterprise",
  "summary": "2-3 sentence brutally honest summary",
  "dimensionScores": { "security": 0-100, "quality": 0-100, "vibe": 0-100, "architecture": 0-100, "deployment": 0-100, "documentation": 0-100, "license": 0-100, "market": 0-100 },
  "security": { "secretsFound": 0, "vulnerabilityCount": 0, "highestSeverity": "none"|"low"|"medium"|"high"|"critical", "vulnerabilities": [{"id":"string","severity":"low"|"medium"|"high"|"critical","title":"string","description":"string","recommendation":"string"}], "score": 0-100 },
  "quality": { "readmeScore": 0-100, "testFramework": null|"string", "codeSmells": 0, "duplicationPercent": 0, "score": 0-100 },
  "vibe": { "overall": 0-100, "recommendations": ["string"] },
  "architecture": { "score": 0-100, "complexityRating": "low"|"medium"|"high"|"very-high", "fileCount": 0 },
  "deployment": { "hasDockerfile": false, "hasCIConfig": false, "hasEnvExample": false, "score": 0-100 },
  "documentation": { "readmeCompleteness": 0-100, "score": 0-100 },
  "license": { "licenseType": null|"string", "isCopyleft": false, "score": 0-100 },
  "market": { "trendAlignment": "rising"|"steady"|"declining", "percentileRank": 0, "score": 0-100 },
  "hallucinatedFeatures": ["string"],
  "bugsAndLeaks": ["string"],
  "structuralSmells": ["string"],
  "quickWins": [{"title":"string","severity":"critical"|"high"|"medium"|"low","category":"string","effort":"minutes"|"hours"|"days","description":"string","action":"string"}],
  "roadmap": [{"phase":"now"|"next"|"later","priority":1,"category":"string","task":"string","effort":"hours"|"days"|"weeks"}],
  "implementationPlan": [{"title":"string","description":"string","targetFiles":["string"],"promptInstruction":"string"}],
  "globalBenchmarkPercent": 0-100
}

Be brutally honest. LLMs tend to overestimate codebase quality. Be critical. If something is missing, say so.`;
}
