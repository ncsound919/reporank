/**
 * Deeper static analysis — goes beyond basic scanning for real developer utility.
 */
export interface DeepStaticFinding {
  type: "dead-export" | "high-complexity" | "low-comment-ratio" | "high-comment-ratio" | "mixed-import-styles" | "duplicate-import" | "circular-dependency" | "large-function" | "unused-param" | "todo-density";
  filePath: string;
  line?: number;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface DeepStaticReport {
  findings: DeepStaticFinding[];
  languageBreakdown: { lang: string; files: number; lines: number; percent: number }[];
  commentRatios: { file: string; ratio: number; lines: number }[];
  todoDensity: { file: string; count: number; density: number }[];
  summary: string;
}

export function analyzeDeep(sourceFiles: { path: string; content: string }[], fileTree: string[]): DeepStaticReport {
  const findings: DeepStaticFinding[] = [];
  const langCounts: Record<string, { files: number; lines: number }> = {};
  const commentRatios: { file: string; ratio: number; lines: number }[] = [];
  const todoDensity: { file: string; count: number; density: number }[] = [];

  const extToLang: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TSX", ".js": "JavaScript", ".jsx": "JSX",
    ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java",
    ".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".kt": "Kotlin",
    ".css": "CSS", ".scss": "SCSS", ".html": "HTML", ".json": "JSON",
    ".md": "Markdown", ".yaml": "YAML", ".yml": "YAML",
  };

  // Track all exported names to detect dead exports
  const exportedNames = new Map<string, string[]>(); // file -> [exports]
  const usedExports = new Set<string>(); // full file path relative

  for (const file of sourceFiles) {
    const ext = file.path.match(/\.[^.]+$/)?.[0] || "";
    const lang = extToLang[ext] || "Other";
    if (!langCounts[lang]) langCounts[lang] = { files: 0, lines: 0 };
    langCounts[lang].files++;
    const lineCount = file.content.split("\n").length;
    langCounts[lang].lines += lineCount;

    // Comment ratio
    const lines = file.content.split("\n");
    const commentLines = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("*") || l.trim().startsWith("/**")).length;
    const blankLines = lines.filter(l => l.trim() === "").length;
    const codeLines = lineCount - commentLines - blankLines;
    const ratio = codeLines > 0 ? commentLines / codeLines : 0;
    commentRatios.push({ file: file.path, ratio, lines: lineCount });

    // TODO density
    const todos = (file.content.match(/\/\/\s*(TODO|FIXME|HACK)/gi) || []).length;
    if (todos > 0) {
      todoDensity.push({ file: file.path, count: todos, density: todos / Math.max(1, lineCount) * 100 });
    }

    // Export tracking
    const exports = file.content.match(/\bexport\s+(function|const|class|interface|type)\s+(\w+)/g);
    if (exports) {
      exportedNames.set(file.path, exports.map(e => e.split(/\s+/).pop() || ""));
    }

    // Dead export: exported but never imported by any other file
    const fileName = file.path.split("/").pop() || "";
    const isIndex = fileName === "index.ts" || fileName === "index.tsx" || fileName === "index.js";
    if (!isIndex && exports && exports.length > 5) {
      // Check if this file is imported anywhere
      const fileImportName = file.path.replace(/\.(ts|tsx|js|jsx)$/, "");
      const isImported = sourceFiles.some(f =>
        f.path !== file.path && f.content.includes(`from "./${fileImportName}"`)
      );
      if (!isImported) {
        findings.push({
          type: "dead-export", filePath: file.path, severity: "low",
          detail: `${exports.length} exports but not imported by any other file — possibly dead module`,
        });
      }
    }

    // Mixed import styles
    const hasRequire = file.content.includes("require(");
    const hasImport = /^import\s/.test(file.content);
    if (hasRequire && hasImport) {
      findings.push({
        type: "mixed-import-styles", filePath: file.path, severity: "low",
        detail: "Mixes require() and import — inconsistent module system",
      });
    }

    // Large function detection (heuristic: function with >50 lines)
    const fnMatches = file.content.match(/(?:async\s+)?function\s+\w+\s*\([\s\S]*?(?=\n\})/g);
    if (fnMatches) {
      for (const fn of fnMatches) {
        if (fn.split("\n").length > 50) {
          const fnName = fn.match(/(?:async\s+)?function\s+(\w+)/)?.[1] || "anonymous";
          findings.push({
            type: "large-function", filePath: file.path, severity: "medium",
            detail: `Function '${fnName}' is ${fn.split("\n").length} lines — consider splitting`,
          });
        }
      }
    }

    // Duplicate imports
    const importLines = file.content.match(/^import\s.*from\s['"].*['"]/gm) || [];
    const seenImports = new Set<string>();
    for (const imp of importLines) {
      if (seenImports.has(imp)) {
        findings.push({
          type: "duplicate-import", filePath: file.path, severity: "low",
          detail: `Duplicate import: ${imp.slice(0, 60)}`,
        });
      }
      seenImports.add(imp);
    }
  }

  // Language breakdown percentages
  const totalLines = Object.values(langCounts).reduce((s, v) => s + v.lines, 0);
  const languageBreakdown = Object.entries(langCounts)
    .map(([lang, data]) => ({
      lang, files: data.files, lines: data.lines,
      percent: totalLines > 0 ? Math.round((data.lines / totalLines) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.lines - a.lines);

  // Top comment ratios
  const sortedCommentRatios = commentRatios.sort((a, b) => b.ratio - a.ratio).slice(0, 10);

  // Top TODO density
  const sortedTodos = todoDensity.sort((a, b) => b.density - a.density).slice(0, 10);

  return {
    findings,
    languageBreakdown,
    commentRatios: sortedCommentRatios,
    todoDensity: sortedTodos,
    summary: `${findings.length} deep analysis findings. ${languageBreakdown[0]?.lang || "Unknown"} is the primary language (${languageBreakdown[0]?.percent || 0}% of code).`,
  };
}
