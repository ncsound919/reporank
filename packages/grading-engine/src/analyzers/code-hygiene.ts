/**
 * Code Hygiene Scanner — catches basic coding mistakes and oversights
 * that any competent linter or senior dev would flag in code review.
 * Fully deterministic, no AI needed.
 */
export interface CodeHygieneFinding {
  category: "null-safety" | "error-handling" | "async-hygiene" | "comparison-bug" | "console-left-in" | "debugger-left-in" | "unused-import" | "parameter-bloat" | "array-safety" | "number-safety" | "mutation-bug" | "memory-leak" | "css-accessibility" | "todo-left" | "commented-code" | "duplicate-export" | "empty-export" | "bool-comparison" | "switch-missing-default" | "magic-string" | "naming-smell";
  filePath: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  fixSuggestion: string;
}

export interface CodeHygieneReport {
  findings: CodeHygieneFinding[];
  totalCount: number;
  categoriesFound: string[];
  score: number;
  summary: string;
}

export function scanCodeHygiene(sourceFiles: { path: string; content: string }[]): CodeHygieneReport {
  const findings: CodeHygieneFinding[] = [];
  const categoriesFound = new Set<string>();

  for (const file of sourceFiles) {
    // Skip config files, lockfiles, and markdown from deep code scanning
    if (file.path.endsWith(".json") || file.path.endsWith(".md") || file.path.endsWith(".yaml") || file.path.endsWith(".yml") || file.path.endsWith(".lock")) continue;
    const lines = file.content.split("\n");
    const fp = file.path;

    // ─── 1. NULL/UNDEFINED SAFETY ──────────────────────────────────
    // Check for .map() called on something that could be null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if ((line.includes(".map(") || line.includes(".filter(") || line.includes(".reduce(")) && !line.includes("?.") && !line.includes("|| []") && !line.includes("??") && !line.includes("if") && !line.includes("&&")) {
        const match = line.match(/(\w+)\.(map|filter|reduce|forEach)\(/);
        if (match && !match[1].startsWith("this.") && !match[1].startsWith("React.")) {
          findings.push({
            category: "null-safety", filePath: fp, line: i + 1, severity: "high",
            detail: `${match[1]}.${match[2]}() called without null guard — crashes if data is undefined`,
            fixSuggestion: `Add optional chaining: ${match[1]}?.${match[2]}() or default: (${match[1]} || []).${match[2]}()`,
          });
        }
      }
    }

    // ─── 2. ERROR HANDLING ──────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Empty catch block
      if (trimmed === "catch {}" || trimmed === "catch{}" || trimmed === "catch (e) {}" || trimmed === "catch(e){}" || trimmed === "catch (_e) {}" || trimmed === "catch(_e){}" || trimmed === "try{}catch{}") {
        findings.push({
          category: "error-handling", filePath: fp, line: i + 1, severity: "critical",
          detail: "Empty catch block silently swallows all errors",
          fixSuggestion: "At minimum log the error: catch (err) { console.error('Failed:', err); } or handle specifically",
        });
      }
      // Catch that only console.logs (not console.error)
      if (trimmed.match(/catch\s*\(.*\)\s*\{\s*console\.(log|warn)\s*\(/)) {
        findings.push({
          category: "error-handling", filePath: fp, line: i + 1, severity: "medium",
          detail: "Error caught but only logged at info/warn level — may be missed in production monitoring",
          fixSuggestion: "Use console.error for errors to ensure they appear in error monitoring dashboards",
        });
      }
    }

    // ─── 3. ASYNC HYGIENE ───────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // .then() without return in arrow function
      if (trimmed.match(/^\s*\.then\(\s*(\([^)]*\)|\w+)\s*=>\s*\{$/) && !trimmed.includes("return ") && !trimmed.includes("await ")) {
        const nextLine = lines[i + 1]?.trim() || "";
        if (nextLine && !nextLine.startsWith("return ") && !nextLine.startsWith("await ") && !nextLine.startsWith("}")) {
          // Check if the promise result isn't used for anything — might be fire-and-forget
        }
      }
      // await in a non-async function
      if (trimmed.includes("await ") && !file.content.includes("async ") && !file.content.includes("async(") && !file.content.includes("async (")) {
        // Only flag if this is the first await and function isn't async
        const fnMatch = file.content.match(/(?:function|=>)\s*\{[\s\S]*?\bawait\b/);
        const hasAsyncWrapper = file.content.includes("(async () =>") || file.content.includes("async function");
        if (!hasAsyncWrapper) {
          findings.push({
            category: "async-hygiene", filePath: fp, line: i + 1, severity: "high",
            detail: `'await' used but enclosing function is not declared async — will throw SyntaxError`,
            fixSuggestion: "Add 'async' keyword to the enclosing function declaration",
          });
          break; // Only once per file
        }
      }
    }

    // Mixed promise styles (then + await in same file)
    const hasThen = file.content.includes(".then(");
    const hasAwait = file.content.includes("await ");
    if (hasThen && hasAwait) {
      // Only flag if both are used outside of test files
      if (!fp.includes(".test.")) {
        const thenCount = (file.content.match(/\.then\(/g) || []).length;
        const awaitCount = (file.content.match(/\bawait\b/g) || []).length;
        if (thenCount > 2 && awaitCount > 2) {
          findings.push({
            category: "async-hygiene", filePath: fp, severity: "medium",
            detail: `Mix of ${thenCount}x .then() and ${awaitCount}x await — inconsistent async patterns`,
            fixSuggestion: "Prefer async/await consistently. Convert .then() chains to async/await for readability and better stack traces.",
          });
        }
      }
    }

    // ─── 4. COMPARISON BUGS ─────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // == instead of === (but not null checks like == null)
      const looseCmp = line.match(/[^!<>=]=[^=][^=]/g);
      if (looseCmp && !line.includes("== null") && !line.includes("== undefined") && !line.includes("require") && !line.includes("// eslint")) {
        const pos = line.indexOf(looseCmp[0]);
        if (pos > 0) {
          const before = line[pos - 1];
          // Make sure it's a real loose equality, not part of assignment or something else
          if (line[pos + 1] === '=' && line[pos] !== '=' && line[pos] !== '!' && line[pos] !== '>' && line[pos] !== '<') {
            findings.push({
              category: "comparison-bug", filePath: fp, line: i + 1, severity: "high",
              detail: "Loose equality (==) instead of strict (===) — can cause unexpected type coercion bugs",
              fixSuggestion: "Replace == with === for strict equality comparison",
            });
          }
        }
      }

      // if (x === true) or if (x === false)
      if (trimmed.match(/if\s*\(\s*\w+\s*===\s*(true|false)\s*\)/)) {
        findings.push({
          category: "bool-comparison", filePath: fp, line: i + 1, severity: "low",
          detail: `Redundant boolean comparison: ${trimmed.replace(/if\s*\((.*)\)/, "$1")}`,
          fixSuggestion: "Use 'if (x)' instead of 'if (x === true)' and 'if (!x)' instead of 'if (x === false)'",
        });
      }
    }

    // parseInt without radix
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("parseInt(") && !lines[i].includes("parseInt(_, 10)") && !lines[i].includes("parseInt(x, ") && !lines[i].includes("parseInt(value, ") && !lines[i].includes("// eslint-disable")) {
        const match = lines[i].match(/parseInt\((\w+)\)/);
        if (match) {
          findings.push({
            category: "number-safety", filePath: fp, line: i + 1, severity: "high",
            detail: `parseInt(${match[1]}) called without radix parameter — parses octal in older engines`,
            fixSuggestion: `Use parseInt(${match[1]}, 10) to ensure decimal parsing`,
          });
        }
      }

      // NaN comparison
      if (lines[i].match(/\w+\s*===\s*NaN/) || lines[i].match(/NaN\s*===\s*\w+/)) {
        findings.push({
          category: "number-safety", filePath: fp, line: i + 1, severity: "high",
          detail: "Direct comparison with NaN — NaN === NaN is always false in JavaScript",
          fixSuggestion: "Use Number.isNaN(value) instead of value === NaN",
        });
      }
    }

    // ─── 5. CONSOLE LEFT IN ─────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("console.log(")) {
        // Only flag if not in test files (tests use console.log for debugging)
        if (!fp.includes(".test.") && !fp.includes("__tests__")) {
          findings.push({
            category: "console-left-in", filePath: fp, line: i + 1, severity: "medium",
            detail: "console.log left in production code — leaks data to stdout",
            fixSuggestion: "Remove console.log or replace with structured logger (pino.info / logger.debug)",
          });
        }
      }

      // debugger statement
      if (trimmed === "debugger;" || trimmed === "debugger" && i > 5) {
        findings.push({
          category: "debugger-left-in", filePath: fp, line: i + 1, severity: "critical",
          detail: "debugger statement left in code — will pause execution in devtools",
          fixSuggestion: "Remove debugger statement before committing",
        });
      }
    }

    // ─── 6. TODO/FIXME LEFT ─────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const todoMatch = trimmed.match(/\/\/\s*(TODO|FIXME|HACK|XXX|BUG)[:\s]/);
      if (todoMatch) {
        const severity = todoMatch[1] === "FIXME" || todoMatch[1] === "BUG" ? "high" : "low";
        findings.push({
          category: "todo-left", filePath: fp, line: i + 1, severity: severity as any,
          detail: `${todoMatch[1]} comment left in code: ${trimmed.replace(/\/\/\s*/, "").slice(0, 80)}`,
          fixSuggestion: severity === "high" ? "Address this before shipping — it's marked as broken" : "Track in issue tracker and remove from code",
        });
      }
    }

    // ─── 7. PARAMETER BLOAT ──────────────────────────────────────────
    const fnWithManyParams = file.content.match(/function\s+\w+\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/);
    if (fnWithManyParams) {
      for (const match of file.content.matchAll(/function\s+(\w+)\s*\(([^)]+)\)/g)) {
        const params = match[2].split(",").filter(Boolean);
        if (params.length > 6) {
          findings.push({
            category: "parameter-bloat", filePath: fp, severity: "medium",
            detail: `${match[1]}() has ${params.length} parameters — hard to call correctly`,
            fixSuggestion: `Refactor to accept an options object: ${match[1]}({ ${params.slice(0, 3).map(p => p.trim().split(":").map(s => s.trim()).filter(Boolean)[0]).join(", ")}, ... })`,
          });
        }
      }
    }

    // ─── 8. ARRAY SAFETY ────────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // for...in on array
      if (trimmed.match(/for\s*\(\s*(let|var|const)\s+\w+\s+in\s+\w+(\.\w+)?\s*\)/)) {
        const varName = trimmed.match(/for\s*\(\s*(let|var|const)\s+(\w+)\s+in\s+(\w+)/);
        if (varName && !trimmed.includes(".length")) {
          findings.push({
            category: "array-safety", filePath: fp, line: i + 1, severity: "medium",
            detail: "for...in loop on array — iterates over enumerable properties, not array indices",
            fixSuggestion: "Use for...of for arrays, or .forEach(), or for (let i = 0; i < arr.length; i++)",
          });
        }
      }
    }

    // ─── 9. MUTATION BUGS ────────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Direct parameter mutation
      if (trimmed.match(/^\s*\w+\s*=\s*[^=]/) && lines[i - 1]?.includes("function(") || trimmed.match(/^\s*\w+\s*=\s*[^=]/) && lines[i - 1]?.includes("=> {")) {
        const param = trimmed.match(/^\s*(\w+)\s*=\s/);
        if (param && file.content.includes(param[1]) && lines.slice(0, i).some(l => l.includes(`(${param[1]}`) || l.includes(`, ${param[1]}`) || l.includes(`${param[1]}:`))) {
          findings.push({
            category: "mutation-bug", filePath: fp, line: i + 1, severity: "medium",
            detail: `Function parameter '${param[1]}' is reassigned — mutates caller's reference`,
            fixSuggestion: "Assign to a new variable instead: const modified = ...",
          });
        }
      }
    }

    // ─── 10. MEMORY LEAK PATTERNS ────────────────────────────────────
    const intervalCalls = file.content.match(/setInterval\(/g);
    const clearIntervalCalls = file.content.match(/clearInterval\(/g);
    if (intervalCalls && (!clearIntervalCalls || clearIntervalCalls.length < intervalCalls.length)) {
      const unclosed = (intervalCalls.length) - (clearIntervalCalls?.length || 0);
      if (unclosed > 0 && !fp.includes(".test.")) {
        findings.push({
          category: "memory-leak", filePath: fp, severity: "high",
          detail: `${unclosed} setInterval() call(s) without matching clearInterval() — runs forever`,
          fixSuggestion: "Store the interval ID and clear it in the cleanup/unmount handler: const id = setInterval(...); clearInterval(id)",
        });
      }
    }

    // addEventListener without removeEventListener
    const addListeners = (file.content.match(/addEventListener\(/g) || []).length;
    const removeListeners = (file.content.match(/removeEventListener\(/g) || []).length;
    if (addListeners > removeListeners && addListeners > 2 && !fp.includes(".test.")) {
      findings.push({
        category: "memory-leak", filePath: fp, severity: "high",
        detail: `${addListeners - removeListeners} more addEventListener() than removeEventListener() — listener leaks`,
        fixSuggestion: "Always pair addEventListener with removeEventListener in cleanup: element.removeEventListener('click', handler)",
      });
    }

    // ─── 11. SWITCH STATEMENT ISSUES ─────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("switch(") || trimmed.startsWith("switch (")) {
        const switchEnd = file.content.indexOf("}", i);
        const switchBlock = file.content.slice(i, switchEnd > 0 ? switchEnd : i + 200);

        // Missing default case
        const hasDefault = switchBlock.includes("default:");
        const hasCases = switchBlock.includes("case ");
        if (hasCases && !hasDefault) {
          findings.push({
            category: "switch-missing-default", filePath: fp, line: i + 1, severity: "medium",
            detail: "Switch statement has case clauses but no default — unhandled values silently pass through",
            fixSuggestion: "Add a default case that either handles the fallback explicitly or logs a warning",
          });
        }
      }
    }

    // ─── 12. MAGIC STRINGS ─────────────────────────────────────────────
    // Flag repeated string literals that should be constants
    const stringLiterals = new Map<string, number[]>();
    const strMatches = file.content.matchAll(/["']([a-zA-Z][a-zA-Z0-9_-]{3,})["']/g);
    for (const m of strMatches) {
      const key = m[1];
      if (!stringLiterals.has(key)) stringLiterals.set(key, []);
      stringLiterals.get(key)!.push(m.index!);
    }

    for (const [literal, positions] of stringLiterals) {
      if (positions.length > 3 && !["true", "false", "null", "undefined", "GET", "POST", "PUT", "DELETE", "PATCH", "localhost"].includes(literal)) {
        findings.push({
          category: "magic-string", filePath: fp, severity: "low",
          detail: `String "${literal}" used ${positions.length} times — should be extracted to a named constant`,
          fixSuggestion: `Extract to constant: const ${literal.toUpperCase().replace(/[^A-Z0-9_]/g, "_")} = "${literal}";`,
        });
        break; // Only flag once per file per string
      }
    }

    // ─── 13. NAMING SMELLS ──────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Single-letter variable names in non-trivial scope
      if (trimmed.match(/\b(let|var|const)\s+[a-z]\s*=/) && !trimmed.includes("for ") && !trimmed.includes("map(") && !trimmed.includes("index")) {
        const varMatch = trimmed.match(/\b(let|var|const)\s+([a-z])\s*=/);
        if (varMatch && !["i", "j", "k", "x", "y", "n"].includes(varMatch[2])) {
          findings.push({
            category: "naming-smell", filePath: fp, line: i + 1, severity: "low",
            detail: `Single-letter variable '${varMatch[2]}' — unclear purpose`,
            fixSuggestion: "Use a descriptive name that conveys what the variable represents",
          });
        }
      }
    }
  }

  // Deduplicate findings (same file, same category, similar detail)
  const unique = new Map<string, CodeHygieneFinding>();
  for (const f of findings) {
    // Truncate detail for dedup key
    const key = `${f.filePath}:${f.category}:${f.detail.slice(0, 40)}`;
    if (!unique.has(key)) unique.set(key, f);
  }

  const uniqueFindings = [...unique.values()];

  const categoryCounts = new Set(uniqueFindings.map(f => f.category));
  const criticalCount = uniqueFindings.filter(f => f.severity === "critical").length;
  const highCount = uniqueFindings.filter(f => f.severity === "high").length;
  const mediumCount = uniqueFindings.filter(f => f.severity === "medium").length;
  const lowCount = uniqueFindings.filter(f => f.severity === "low").length;

  const totalCount = uniqueFindings.length;
  const totalLines = sourceFiles.reduce((sum, f) => sum + f.content.split('\n').length, 0) || 1;
  const findingsPer100Lines = (totalCount / totalLines) * 100;
  const score = Math.round(Math.max(0, Math.min(100, 100 - findingsPer100Lines * 10)));

  return {
    findings: uniqueFindings,
    totalCount,
    categoriesFound: [...categoryCounts],
    score,
    summary: `${totalCount} code hygiene issues: ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low. Score: ${score}/100.`,
  };
}
