import { readFileSync, statSync } from "node:fs";
import { join, extname, dirname, relative } from "node:path";

export interface FileHotSpot {
  filePath: string;
  size: number;
  lines: number;
  concern: "bloat" | "god-file" | "deep-nesting" | "low-cohesion" | "duplicate-basket";
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
}

export interface ComplexityReport {
  hotSpots: FileHotSpot[];
  fileSizeDistribution: { small: number; medium: number; large: number; xlarge: number };
  longestFiles: { path: string; lines: number }[];
  worstFiles: { path: string; score: number; reasons: string[] }[];
  cohesionViolations: string[];
  summary: string;
}

export function analyzeComplexity(repoPath: string, sourceFiles: { path: string; content: string }[]): ComplexityReport {
  const hotSpots: FileHotSpot[] = [];
  const fileSizes = { small: 0, medium: 0, large: 0, xlarge: 0 };
  const longestFiles: { path: string; lines: number }[] = [];
  const cohesionViolations: string[] = [];
  const fileScores: Map<string, { score: number; reasons: string[] }> = new Map();

  for (const file of sourceFiles) {
    // Skip markdown and JSON files from complexity analysis (different structure)
    if (file.path.endsWith(".md") || file.path.endsWith(".json") || file.path.endsWith(".yaml") || file.path.endsWith(".yml")) {
      fileSizes.small++;
      longestFiles.push({ path: file.path, lines: file.content.split("\n").length });
      continue;
    }

    const lines = file.content.split("\n");
    const lineCount = lines.length;
    let score = 0;
    const reasons: string[] = [];

    // Size classification
    if (lineCount <= 100) fileSizes.small++;
    else if (lineCount <= 300) fileSizes.medium++;
    else if (lineCount <= 600) { fileSizes.large++; score += 20; }
    else { fileSizes.xlarge++; score += 40; }

    longestFiles.push({ path: file.path, lines: lineCount });

    // God-file detection: too many exports/classes for one file
    const exportCount = (file.content.match(/\bexport\s+(function|const|class|interface|type)\s/g) || []).length;
    const functionCount = (file.content.match(/\bfunction\s+\w+/g) || []).length;
    const classCount = (file.content.match(/\bclass\s+\w+/g) || []).length;

    if (exportCount > 15) {
      score += 25;
      reasons.push(`${exportCount} exports — file doing too many things`);
      hotSpots.push({
        filePath: file.path, size: file.content.length, lines: lineCount,
        concern: "god-file", severity: "high",
        detail: `${exportCount} exports in one file suggests ${file.path} should be split into ${Math.ceil(exportCount / 5)} separate modules`,
      });
    }

    // Deep nesting detection
    const nestingDepth = calculateMaxNesting(lines);
    if (nestingDepth > 6) {
      score += 15;
      reasons.push(`nesting depth of ${nestingDepth} — high cyclomatic complexity`);
      hotSpots.push({
        filePath: file.path, size: file.content.length, lines: lineCount,
        concern: "deep-nesting", severity: "high",
        detail: `Maximum nesting depth of ${nestingDepth} — consider extracting inner logic into separate functions to reduce cognitive load`,
      });
    }

    // Low cohesion: mixed concerns in one file
    const importCount = (file.content.match(/^import\s/gm) || []).length;
    const topicAreas = detectTopicAreas(file.content);
    if (topicAreas.size > 3 && lineCount > 200) {
      score += 10;
      reasons.push(`mixed concerns: ${[...topicAreas].join(", ")}`);
      hotSpots.push({
        filePath: file.path, size: file.content.length, lines: lineCount,
        concern: "low-cohesion", severity: "medium",
        detail: `File mixes ${[...topicAreas].join(", ")} — split into dedicated modules`,
      });
    }

    // Bloat detection
    const blankLines = lines.filter(l => l.trim() === "").length;
    const commentLines = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("*") || l.trim().startsWith("/**")).length;
    if (blankLines > lineCount * 0.3) {
      score += 5;
      reasons.push(`${blankLines} blank lines (${Math.round(blankLines / lineCount * 100)}%) — excessive whitespace`);
    }
    if (commentLines > lineCount * 0.4) {
      score += 5;
      reasons.push(`${commentLines} comment lines (${Math.round(commentLines / lineCount * 100)}%) — possible documentation-in-code anti-pattern`);
    }

    // Duplicate basket: files that import from too many different places
    const uniqueDirs = new Set<string>();
    for (const imp of file.content.matchAll(/from\s+["']([^"']+)["']/g)) {
      const imported = imp[1];
      if (imported.startsWith(".")) {
        const resolvedDir = dirname(imported);
        uniqueDirs.add(resolvedDir !== "." ? resolvedDir : "same-level");
      }
    }
    if (uniqueDirs.size > 8) {
      score += 10;
      reasons.push(`imports from ${uniqueDirs.size} different directories — too many dependencies`);
      hotSpots.push({
        filePath: file.path, size: file.content.length, lines: lineCount,
        concern: "duplicate-basket", severity: "low",
        detail: `Imports from ${uniqueDirs.size} different locations — consider consolidating or rethinking module boundaries`,
      });
    }

    if (score > 0) fileScores.set(file.path, { score, reasons });
  }

  // Cohesion violations: files in wrong places
  for (const file of sourceFiles) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    const dir = parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    const ext = extname(name);

    // Test file not in __tests__ directory
    if ((name.includes("test") || name.includes("spec")) && !file.path.includes("__tests__") && !file.path.includes("test/")) {
      cohesionViolations.push(`${file.path} — test file outside __tests__ directory`);
    }

    // File in wrong directory based on name
    if (name.startsWith("use") && !dir.includes("hooks") && !dir.includes("hook")) {
      cohesionViolations.push(`${file.path} — React hook not in hooks/ directory`);
    }
    if ((name.includes("Controller") || name.includes("Handler")) && !dir.includes("routes") && !dir.includes("controllers") && !dir.includes("handlers")) {
      cohesionViolations.push(`${file.path} — route handler outside routes/ directory`);
    }
  }

  longestFiles.sort((a, b) => b.lines - a.lines);

  const sortedScores = [...fileScores.entries()].sort((a, b) => b[1].score - a[1].score);
  const worstFiles = sortedScores.slice(0, 5).map(([path, data]) => ({ path, score: data.score, reasons: data.reasons }));

  const totalFiles = sourceFiles.length;
  const avgLines = totalFiles > 0 ? Math.round(longestFiles.reduce((s, f) => s + f.lines, 0) / totalFiles) : 0;
  const largeFilePct = totalFiles > 0 ? Math.round(((fileSizes.large + fileSizes.xlarge) / totalFiles) * 100) : 0;

  return {
    hotSpots,
    fileSizeDistribution: fileSizes,
    longestFiles: longestFiles.slice(0, 5),
    worstFiles,
    cohesionViolations,
    summary: `${totalFiles} files analyzed. ${fileSizes.xlarge} oversized (>600 lines), ${fileSizes.large} large (300-600). ` +
      `Average ${avgLines} lines/file. ${largeFilePct}% files are large or oversized. ${worstFiles[0] ? `Worst: ${worstFiles[0].path} (score ${worstFiles[0].score}).` : ""}`,
  };
}

function calculateMaxNesting(lines: string[]): number {
  let maxDepth = 0, currentDepth = 0;
  const openers = /\b(if|for|while|switch|catch|function\s*\w*\s*\(|=>\s*\{|try)\s*/;
  const closers = /^\s*\}/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (closers.test(trimmed)) currentDepth = Math.max(0, currentDepth - 1);
    if (openers.test(trimmed)) { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
  }

  return maxDepth;
}

function detectTopicAreas(content: string): Set<string> {
  const topics = new Set<string>();
  const topicKeywords: Record<string, RegExp> = {
    "auth": /\b(login|signup|token|password|session|oauth|jwt)\b/i,
    "database": /\b(query|insert|update|delete|mutation|prisma|sql|model)\b/i,
    "networking": /\b(fetch|axios|request|response|api|endpoint|route|http)\b/i,
    "UI": /\b(render|component|jsx|tsx|style|css|html|div|span)\b/i,
    "error-handling": /\b(throw|catch|error|exception|try|finally)\b/i,
    "logging": /\b(console\.log|logger|warn|debug|info|trace)\b/i,
    "file-io": /\b(readFile|writeFile|fs\.|stream|path\.|buffer)\b/i,
    "security": /\b(encrypt|decrypt|hash|salt|crypto|sanitize|escape)\b/i,
  };

  for (const [topic, regex] of Object.entries(topicKeywords)) {
    if (regex.test(content)) topics.add(topic);
  }

  return topics;
}
