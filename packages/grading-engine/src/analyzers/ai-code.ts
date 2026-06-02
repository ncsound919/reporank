/**
 * AI-Generated Code Analyzer — detects patterns unique to LLM-written code.
 * Vibe coders ship fast. This tells senior devs exactly where to take over.
 */
import { existsSync } from "node:fs";

export interface AiCodeFinding {
  pattern: "spaghetti-nesting" | "over-engineering" | "dead-abstraction" | "hallucinated-import" | "duplicate-impl" | "circular-dependency" | "missing-error-boundary" | "security-naivety" | "inconsistent-pattern" | "any-abuse" | "hardcoded-everything" | "infinite-loop-risk" | "promise-garden" | "copy-paste-module";
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  seniorNote: string;
  fixSuggestion: string;
}

export interface AiCodeReport {
  findings: AiCodeFinding[];
  spaghettiScore: number; // 0-100, higher = more spaghetti
  takeOverPoints: string[]; // Key areas a senior dev should address first
  summary: string;
}

// ─── AI CODE ANALYSIS ENGINE ───────────────────────────────────────────

export function analyzeAiCode(
  sourceFiles: { path: string; content: string }[],
  fileTree: string[],
  packageJsonContent?: string,
): AiCodeReport {
  const findings: AiCodeFinding[] = [];
  let spaghettiScore = 0;

  if (!sourceFiles || sourceFiles.length === 0) {
    return { findings: [], spaghettiScore: 0, takeOverPoints: [], summary: "No source files to analyze" };
  }

  // Track state across files
  const allContent = sourceFiles.map(f => f.content).join("\n");
  const filePaths = sourceFiles.map(f => f.path);
  const implementations = new Map<string, { file: string; line: number; content: string }[]>(); // function name -> occurrences

  // ─── 1. SPAGHETTI NESTING DETECTION ──────────────────────────────
  for (const file of sourceFiles) {
    if (!file.content) continue;
    const lines = file.content.split("\n");

    // Detect deep nesting (callback hell, nested ternaries, nested conditionals)
    let maxDepth = 0;
    let currentDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.endsWith("{") || trimmed.endsWith("(") || trimmed.endsWith("=>")) currentDepth++;
      if (trimmed.startsWith("}") || trimmed.startsWith(")") || trimmed.startsWith("],") || trimmed.startsWith("]")) currentDepth = Math.max(0, currentDepth - 1);
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    if (maxDepth >= 8) {
      spaghettiScore += 15;
      findings.push({
        pattern: "spaghetti-nesting", file: file.path, severity: "critical",
        detail: `Nesting depth of ${maxDepth} — classic AI-generated spaghetti code`,
        seniorNote: "AI models generate deeply nested code because they predict tokens left-to-right without global structure awareness. This is THE hallmark of vibe-coded systems.",
        fixSuggestion: "Extract inner logic into named functions. Each function should do ONE thing. Target max depth of 4.",
      });
    } else if (maxDepth >= 5) {
      spaghettiScore += 5;
      findings.push({
        pattern: "spaghetti-nesting", file: file.path, severity: "medium",
        detail: `Nesting depth of ${maxDepth} — could be simpler`,
        seniorNote: "High nesting makes code hard to read and debug. AI tends to add layers instead of extracting functions.",
        fixSuggestion: "Consider extracting the inner ${maxDepth - 3} levels into separate functions.",
      });
    }

    // ─── 2. OVER-ENGINEERING DETECTION ────────────────────────────
    // AI loves: abstract factory, strategy pattern for 2 cases, builder pattern for simple objects
    const abstractFactories = (file.content.match(/abstract\s+class\s+\w+/g) || []).length;
    const interfaces = (file.content.match(/\binterface\s+\w+/g) || []).length;
    const typeAliases = (file.content.match(/\btype\s+\w+\s*=/g) || []).length;
    const totalTypes = interfaces + typeAliases;
    const totalFunctions = (file.content.match(/\bfunction\s+\w+/g) || []).length;

    if (totalTypes > totalFunctions * 2 && totalTypes > 5) {
      spaghettiScore += 10;
      findings.push({
        pattern: "over-engineering", file: file.path, severity: "high",
        detail: `${totalTypes} types for ${totalFunctions} functions — ${(totalTypes / Math.max(1, totalFunctions)).toFixed(1)}x more types than implementations`,
        seniorNote: "AI over-abstracts because it's trained on enterprise Java codebases. A vibe-coded project with 15 interfaces and 3 functions has an architecture astronaut problem.",
        fixSuggestion: `Remove types that have only one implementation. ${interfaces > 3 ? "You likely have " + (interfaces - 2) + " interfaces that could be replaced with simple types." : ""}`,
      });
    }

    if (abstractFactories > 0 && totalFunctions < 10) {
      spaghettiScore += 8;
      findings.push({
        pattern: "over-engineering", file: file.path, severity: "medium",
        detail: `Has abstract classes but only ${totalFunctions} functions — unlikely to need factory patterns`,
        seniorNote: "Abstract factory in a small codebase is a smell. AI over-applies enterprise patterns.",
        fixSuggestion: "Replace abstract class with a simple function. You can add abstraction later when you actually have multiple implementations.",
      });
    }

    // ─── 3. DUPLICATE IMPLEMENTATION DETECTION ────────────────────
    const fnRegex = /(?:async\s+)?function\s+(\w+)\s*\([^]*?(?=\n(?:async\s+)?function|\n\}|$)/g;
    const fnMatches = file.content.matchAll(fnRegex);
    for (const match of fnMatches) {
      const fnName = match[1];
      const fnBody = match[0].slice(match[0].indexOf("{") + 1, match[0].lastIndexOf("}")).trim();
      if (fnBody.length > 30) {
        if (!implementations.has(fnName)) implementations.set(fnName, []);
        implementations.get(fnName)!.push({ file: file.path, line: getLineNumber(lines, fnName), content: fnBody });
      }
    }

    // ─── 4. HALLUCINATED IMPORT DETECTION ─────────────────────────
    // AI imports packages that look real but don't exist
    const suspiciousImports: string[] = [];
    const importMatches = file.content.matchAll(/(?:from|require)\s*\(?\s*["']([^"']+)["']/g);
    for (const m of importMatches) {
      const imp = m[1];
      if (imp.startsWith(".")) continue;
      const pkgName = imp.split("/")[0].startsWith("@") ? imp.split("/").slice(0, 2).join("/") : imp.split("/")[0];
      // Check for AI-hallucinated package names
      if (/^[A-Z][a-z]+$/.test(pkgName.split("/").pop() || "") && !pkgName.includes(".")) {
        suspiciousImports.push(pkgName);
      }
    }
    if (suspiciousImports.length > 0) {
      for (const pkg of [...new Set(suspiciousImports)]) {
        findings.push({
          pattern: "hallucinated-import", file: file.path, severity: "high",
          detail: `Import '${pkg}' may be AI-hallucinated — camelCase package names are unusual`,
          seniorNote: "AI sometimes invents packages that don't exist. If npm install fails, this is why.",
          fixSuggestion: `Verify '${pkg}' exists on npm. If not, replace with the real package or implement manually.`,
        });
      }
    }

    // ─── 5. MISSING ERROR BOUNDARIES ──────────────────────────────
    const hasAsync = file.content.includes("async ");
    const hasTryCatch = file.content.includes("try {") || file.content.includes("try{");
    const hasDotCatch = file.content.includes(".catch(") || file.content.includes(".catch (");

    if (hasAsync && !hasTryCatch && !hasDotCatch) {
      const firstAsyncLine = lines.findIndex(l => l.includes("async "));
      spaghettiScore += 3;
      findings.push({
        pattern: "missing-error-boundary", file: file.path, line: firstAsyncLine + 1, severity: "high",
        detail: "Async function(s) without try/catch — unhandled rejections crash the process",
        seniorNote: "AI assumes async operations always succeed. In production, APIs fail, DBs timeout, disks fill up.",
        fixSuggestion: "Wrap async function bodies in try/catch. Log errors and return safe fallbacks to the caller.",
      });
    }

    // ─── 6. SECURITY NAIVETY ──────────────────────────────────────
    // AI doesn't sanitize inputs, doesn't validate, doesn't escape
    const hasInnerHTML = file.content.includes("innerHTML") || file.content.includes("dangerouslySetInnerHTML");
    if (hasInnerHTML) {
      findings.push({
        pattern: "security-naivety", file: file.path, severity: "high",
        detail: "Uses innerHTML/dangerouslySetInnerHTML — XSS vulnerability",
        seniorNote: "AI uses innerHTML because it's simple. It doesn't think about cross-site scripting attacks.",
        fixSuggestion: "Replace with textContent or a safe HTML renderer that escapes user input.",
      });
    }

    const hasEval = file.content.includes("eval(");
    if (hasEval) {
      findings.push({
        pattern: "security-naivety", file: file.path, severity: "critical",
        detail: "Uses eval() — arbitrary code execution vulnerability",
        seniorNote: "AI uses eval() because it's flexible. It doesn't understand the security implications.",
        fixSuggestion: "Remove eval(). Use a proper parser or Function constructor with strict mode.",
      });
    }

    // ─── 7. INCONSISTENT PATTERNS ────────────────────────────────
    // AI generates random code from different parts of its training data
    const hasRequire = file.content.includes("require(");
    const hasImport = /^import\s/.test(file.content);
    if (hasRequire && hasImport) {
      findings.push({
        pattern: "inconsistent-pattern", file: file.path, severity: "medium",
        detail: "Mixes require() and import — AI sampled from different codebases",
        seniorNote: "AI doesn't maintain consistency. It generates require() in one place and import in another because different training examples do different things.",
        fixSuggestion: "Choose one module system (import/export for ESM, require/module.exports for CJS) and convert all files to match.",
      });
    }

    // ─── 8. `any` ABUSE ──────────────────────────────────────────
    const anyCount = (file.content.match(/\bany\b/g) || []).length;
    const totalCodeLines = lines.filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*")).length;
    if (anyCount > 10 && totalCodeLines > 0) {
      const anyDensity = anyCount / totalCodeLines;
      if (anyDensity > 0.05) {
        spaghettiScore += 5;
        findings.push({
          pattern: "any-abuse", file: file.path, severity: "medium",
          detail: `${anyCount} 'any' types in ${totalCodeLines} lines of code — ${(anyDensity * 100).toFixed(1)}% density`,
          seniorNote: "AI uses `any` when it doesn't know the type. A vibe-coded TypeScript project that's 5% 'any' has lost its type safety.",
          fixSuggestion: "Replace `any` with proper types. Start with function parameters and return types — those are where bugs hide.",
        });
      }
    }

    // ─── 9. HARDCODED EVERYTHING ──────────────────────────────────
    const hardcodedStrings = (file.content.match(/["'][A-Z_]{3,}["']/g) || []).length;
    const hasEnvConfig = file.content.includes("process.env") || file.content.includes(".env") || file.content.includes("config.");
    if (hardcodedStrings > 5 && !hasEnvConfig) {
      spaghettiScore += 3;
      findings.push({
        pattern: "hardcoded-everything", file: file.path, severity: "medium",
        detail: `${hardcodedStrings} constant-like strings but no env/config usage detected`,
        seniorNote: "AI hardcodes values because it doesn't know about environment configuration patterns.",
        fixSuggestion: `Extract ${hardcodedStrings} hardcoded values into environment variables or a config file.`,
      });
    }

    // ─── 10. PROMISE GARDEN (forgotten promise chains) ─────────
    const promises = (file.content.match(/new\s+Promise\(/g) || []).length;
    const promiseResolves = (file.content.match(/\.resolve\(/g) || []).length;
    const promiseRejects = (file.content.match(/\.reject\(/g) || []).length;
    if (promises > 0 && promiseResolves === 0 && promiseRejects === 0) {
      findings.push({
        pattern: "promise-garden", file: file.path, severity: "high",
        detail: `${promises} new Promise() created but never resolved or rejected — may hang forever`,
        seniorNote: "AI creates Promises but sometimes forgets to call resolve/reject. This is a classic 'works in demo, hangs in production' pattern.",
        fixSuggestion: `${promises > 1 ? "Check each Promise constructor to ensure resolve() or reject() is called in all code paths." : "Add resolve()/reject() calls, or use async/await instead of manual Promise constructors."}`,
      });
    }

    // ─── 11. INFINITE LOOP RISK ──────────────────────────────────
    const whileTrue = (file.content.match(/while\s*\(\s*true\s*\)/g) || []).length;
    if (whileTrue > 0) {
      const hasBreak = file.content.includes("break;");
      findings.push({
        pattern: "infinite-loop-risk", file: file.path, severity: "critical",
        detail: `${whileTrue} while(true) loop(s)${!hasBreak ? " with NO break statement — guaranteed infinite loop" : ""}`,
        seniorNote: "AI uses while(true) when it doesn't know the loop termination condition. This will hang your process.",
        fixSuggestion: hasBreak ? "Verify the break condition is reachable in all code paths." : "Replace with a for loop with a max iteration count or a proper termination condition.",
      });
    }

    // ─── 12. COPY-PASTE MODULE ───────────────────────────────────
    // Check if this file is suspiciously similar to another file
    for (const otherFile of sourceFiles) {
      if (otherFile.path === file.path || !otherFile.content) continue;
      const minLen = Math.min(file.content.length, otherFile.content.length);
      if (minLen > 200) {
        // Simple similarity: compare function signatures
        const fileFns = new Set(file.content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []);
        const otherFns = new Set(otherFile.content.match(/(?:export\s+)?(?:async\s+)?function\s+\w+/g) || []);
        const overlap = [...fileFns].filter(fn => otherFns.has(fn)).length;
        if (overlap >= 3 && fileFns.size >= 3) {
          findings.push({
            pattern: "copy-paste-module", file: file.path, severity: "high",
            detail: `${overlap} function(s) also exist in ${otherFile.path} — likely AI-duplicated module`,
            seniorNote: "AI sometimes generates the same module twice with slightly different names. This creates maintenance headaches.",
            fixSuggestion: `Consolidate ${file.path} and ${otherFile.path} into one module. Import shared functions instead of duplicating them.`,
          });
          break;
        }
      }
    }
  }

  // ─── 13. CIRCULAR DEPENDENCY DETECTION ─────────────────────────
  const importGraph = new Map<string, string[]>();
  for (const file of sourceFiles) {
    if (!file.content) continue;
    const imports: string[] = [];
    for (const m of file.content.matchAll(/(?:from|require)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      imports.push(m[1]);
    }
    importGraph.set(file.path, imports);
  }

  // Simple cycle detection: check if A imports B and B imports A
  for (const [fileA, importsA] of importGraph) {
    for (const imp of importsA) {
      const resolvedPath = resolveImportPath(fileA, imp);
      if (resolvedPath && importGraph.has(resolvedPath)) {
        const importsB = importGraph.get(resolvedPath)!;
        const backImport = importsB.some(bi => {
          const resolved = resolveImportPath(resolvedPath, bi);
          return resolved === fileA;
        });
        if (backImport && fileA < resolvedPath) {
          findings.push({
            pattern: "circular-dependency", file: fileA, severity: "high",
            detail: `Circular dependency between ${fileA} and ${resolvedPath}`,
            seniorNote: "AI creates circular dependencies when it generates code in the wrong order. This causes runtime errors and confuses bundlers.",
            fixSuggestion: `Extract the shared code from ${fileA} and ${resolvedPath} into a shared module, or merge them into one file.`,
          });
        }
      }
    }
  }

  // ─── GENERATE TAKEOVER POINTS ──────────────────────────────────
  const takeOverPoints: string[] = [];
  const criticals = findings.filter(f => f.severity === "critical");
  const highs = findings.filter(f => f.severity === "high");

  if (criticals.length > 0) {
    takeOverPoints.push(`🔴 START HERE: ${criticals.length} critical AI bugs — ${criticals[0].file}: ${criticals[0].detail}`);
  }
  if (findings.some(f => f.pattern === "spaghetti-nesting" && f.severity === "critical")) {
    takeOverPoints.push(`🔴 UNTANGLE: Spaghetti code in ${findings.filter(f => f.pattern === "spaghetti-nesting").map(f => f.file).slice(0, 3).join(", ")}`);
  }
  if (findings.some(f => f.pattern === "missing-error-boundary")) {
    const count = findings.filter(f => f.pattern === "missing-error-boundary").length;
    takeOverPoints.push(`🟡 CATCH: ${count} files have async functions without error handling`);
  }
  if (findings.some(f => f.pattern === "over-engineering")) {
    takeOverPoints.push(`🟡 SIMPLIFY: AI over-engineering detected — abstract classes and factory patterns where functions would do`);
  }
  if (findings.some(f => f.pattern === "infinite-loop-risk")) {
    takeOverPoints.push(`🔴 CRASH RISK: while(true) loop(s) with${findings.some(f => f.pattern === "infinite-loop-risk" && f.detail.includes("NO break")) ? "out" : ""} break statements`);
  }
  if (findings.some(f => f.pattern === "security-naivety")) {
    takeOverPoints.push(`🔴 SECURITY: ${findings.filter(f => f.pattern === "security-naivety").length} security vulnerabilities (XSS, eval, etc.)`);
  }
  if (findings.some(f => f.pattern === "copy-paste-module")) {
    takeOverPoints.push(`🟡 DUPLICATE: ${findings.filter(f => f.pattern === "copy-paste-module").length} modules appear to be AI-duplicated`);
  }
  if (findings.some(f => f.pattern === "promise-garden")) {
    takeOverPoints.push(`🟡 HANGING: Promises created but never resolved — will hang production requests`);
  }
  if (findings.some(f => f.pattern === "circular-dependency")) {
    takeOverPoints.push(`🟡 CIRCULAR: ${findings.filter(f => f.pattern === "circular-dependency").length} circular dependency pairs detected`);
  }
  if (findings.some(f => f.pattern === "any-abuse")) {
    const totalAny = findings.filter(f => f.pattern === "any-abuse").reduce((s, f) => s + parseInt(f.detail.match(/\d+/)?.[0] || "0"), 0);
    takeOverPoints.push(`🟡 TYPES: ~${totalAny} 'any' types across the codebase — type safety is compromised`);
  }

  if (takeOverPoints.length === 0) {
    takeOverPoints.push("✅ This codebase shows few AI-generated patterns. Looks like it was built by an experienced developer.");
  }

  return {
    findings,
    spaghettiScore: Math.min(100, spaghettiScore),
    takeOverPoints: takeOverPoints.slice(0, 10),
    summary: `${findings.length} AI-code issues found. Spaghetti score: ${Math.min(100, spaghettiScore)}/100. ${criticals.length} critical, ${highs.length} high.`,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────

function getLineNumber(lines: string[], fnName: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`function ${fnName}`)) return i + 1;
  }
  return 0;
}

function resolveImportPath(from: string, imp: string): string | null {
  if (!imp.startsWith(".")) return null;
  const fromDir = from.split("/").slice(0, -1);
  const parts = imp.split("/");
  for (const p of parts) {
    if (p === "..") fromDir.pop();
    else if (p !== ".") fromDir.push(p);
  }
  return fromDir.join("/");
}
