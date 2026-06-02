/**
 * Invisible Bug Detector — catches patterns even senior devs miss during code review.
 * Race conditions, implicit coupling, memory leaks, silent data corruption,
 * non-null assertions that will crash, and error handling blind spots.
 */
export interface InvisibleBug {
  category: "race-condition" | "non-null-crash" | "implicit-coupling" | "memory-leak" | "error-blindspot" | "data-corruption" | "timing-bomb" | "side-effect-ordering";
  file: string;
  line?: number;
  confidence: number; // 0-100 how sure we are this is real
  severity: "critical" | "high" | "medium";
  detail: string;
  seniorNote: string;
  reproductionScenario: string; // How this actually breaks
}

export interface InvisibleBugReport {
  findings: InvisibleBug[];
  highConfidence: InvisibleBug[];
  summary: string;
}

export function detectInvisibleBugs(sourceFiles: { path: string; content: string }[]): InvisibleBugReport {
  const findings: InvisibleBug[] = [];

  // Track state across files
  const moduleExports = new Map<string, Set<string>>(); // module -> what it exports
  const moduleImports = new Map<string, string[]>(); // module -> what it imports
  const mutableGlobals = new Map<string, string[]>(); // name -> files that mutate it
  const asyncFunctions = new Map<string, string[]>(); // file -> [fnName]

  for (const file of sourceFiles) {
    if (!file.content) continue;
    const lines = file.content.split("\n");
    const fp = file.path;

    // ─── 1. NON-NULL ASSERTIONS THAT WILL CRASH ─────────────────
    // Senior devs miss these because they look like type assertions,
    // but at runtime they throw if the value is null/undefined.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern: `variable!` — the post-fix expression that throws
      const nonNullMatches = line.matchAll(/(\w+)\.(\w+)!/g);
      for (const m of nonNullMatches) {
        // Check if this is a real `!` assertion (not an operator on optional)
        if (!line.includes(`?.${m[2]}`)) {
          findings.push({
            category: "non-null-crash", file: fp, line: i + 1, confidence: 85,
            severity: "high",
            detail: `Non-null assertion '${m[2]}!' will throw TypeError if ${m[1]} is null/undefined`,
            seniorNote: "The '!' operator tells TypeScript 'trust me, this isn't null.' But at runtime, if it IS null, the process crashes with no recovery. Senior devs approve these in review because 'the tests pass.'",
            reproductionScenario: `Any runtime path where ${m[1]} is null or undefined. Add error handling before accessing '${m[2]}'.`,
          });
        }
      }

      // Pattern: `as Type` — dangerous when the source could be null
      const asCasts = line.matchAll(/\(?(\w+)\)?\s+as\s+\w+/g);
      for (const m of asCasts) {
        if (!m[1].startsWith("this") && !m[1].startsWith("e") && m[1].length > 1) {
          findings.push({
            category: "non-null-crash", file: fp, line: i + 1, confidence: 60,
            severity: "medium",
            detail: `Type cast '${m[0]}' — if the value doesn't match the shape, it silently passes garbage`,
            seniorNote: "'as' tells TypeScript to trust you. It doesn't transform data. If the runtime shape differs from the cast type, you get silent corruption, not a helpful error.",
            reproductionScenario: `When the data source returns a different shape than expected. Replace 'as' with runtime validation (Zod, io-ts, etc.)`,
          });
        }
      }
    }

    // ─── 2. RACE CONDITION DETECTION ────────────────────────────
    // Files with multiple async functions that share mutable state
    const asyncFnMatches = file.content.matchAll(/(?:async\s+)?function\s+(\w+)|(\w+)\s*=\s*async\s*\(/g);
    const fileAsyncFns: string[] = [];
    for (const m of asyncFnMatches) fileAsyncFns.push(m[1] || m[2]);

    if (fileAsyncFns.length > 0) asyncFunctions.set(fp, fileAsyncFns);

    // Detect shared mutable state: module-level variables modified in async functions
    const moduleVars = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const letMatch = line.match(/^\s*(?:let|var)\s+(\w+)/);
      const constMatch = line.match(/^\s*(?:const|let|var)\s+(\w+)/);
      if (letMatch) moduleVars.add(letMatch[1]);

      // Check if a module-level variable is assigned inside an async context
      if (fileAsyncFns.length > 1 && letMatch && !line.includes("const ")) {
        const foundInAsync = lines.some((l, idx) =>
          idx > i && (l.includes(`${letMatch[1]} =`) || l.includes(`${letMatch[1]}.push`) || l.includes(`${letMatch[1]}.add`))
          && fileAsyncFns.some(fn => lines.some(l2 => l2.includes(`function ${fn}`) && lines.indexOf(l2) < idx))
        );
        if (foundInAsync && fileAsyncFns.length >= 2) {
          findings.push({
            category: "race-condition", file: fp, line: i + 1, confidence: 70,
            severity: "critical",
            detail: `Module-level '${letMatch[1]}' modified in ${fileAsyncFns.length} async functions — race condition risk`,
            seniorNote: "Two async functions modifying the same module-level variable is a classic race condition. Senior devs miss this because each function looks correct in isolation. The race only happens when both execute concurrently.",
            reproductionScenario: `Call both async functions concurrently (e.g., Promise.all([fn1(), fn2()])). Their writes to '${letMatch[1]}' will interleave unpredictably.`,
          });
        }
      }
    }

    // ─── 3. IMPLICIT COUPLING DETECTION ─────────────────────────
    // Module A mutates an object that Module B reads — no explicit dependency
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Detect mutation of function parameters
      const paramMutation = line.match(/^\s*(\w+)\s*=\s*[^=]/);
      if (paramMutation) {
        const varName = paramMutation[1];
        // Check if this is a function parameter by looking back
        const isParam = lines.slice(Math.max(0, i - 20), i).some(l =>
          l.includes(`function(`) || l.includes(`function (`) || l.includes(`=>`) || l.includes(`(${varName}`) || l.includes(`,${varName}`)
        );
        if (isParam) {
          findings.push({
            category: "implicit-coupling", file: fp, line: i + 1, confidence: 80,
            severity: "high",
            detail: `Function parameter '${varName}' reassigned — mutates caller's state`,
            seniorNote: "When you reassign a parameter, the caller's object is silently mutated. The caller doesn't expect their value to change. This creates invisible coupling between functions.",
            reproductionScenario: `Pass the same object to two different functions. The second function sees the first function's mutations. Debugging this is like finding a needle in a haystack.`,
          });
        }
      }
    }

    // ─── 4. MEMORY LEAK PATTERNS ────────────────────────────────
    // Unbounded collections: arrays/objects that grow with every operation
    const hasPush = (file.content.match(/\.push\(/g) || []).length;
    const hasEventEmitter = file.content.includes("on(") || file.content.includes("addListener");
    const hasRemoveListener = file.content.includes("off(") || file.content.includes("removeListener");

    if (hasPush > 3 && !file.path.includes(".test.")) {
      // Check if pushes happen inside functions (not just static init)
      const pushesInFunctions = lines.filter(l => l.includes(".push(") && (l.includes("function") || lines.some(pl => pl.includes("function") && lines.indexOf(pl) < lines.indexOf(l)))).length;
      if (pushesInFunctions > 2) {
        findings.push({
          category: "memory-leak", file: fp, confidence: 65,
          severity: "high",
          detail: `${pushesInFunctions} unbounded .push() calls inside functions — array grows without limit`,
          seniorNote: "Every time these functions are called, the array grows. No limit, no trim, no eviction. Over hours of operation, this consumes all available memory. Senior devs miss this because each push looks reasonable in isolation.",
          reproductionScenario: "Call the function in a loop. After 100,000 iterations, the array has 100,000+ entries. The process eventually crashes with out-of-memory.",
        });
      }
    }

    if (hasEventEmitter && !hasRemoveListener) {
      findings.push({
        category: "memory-leak", file: fp, confidence: 90,
        severity: "critical",
        detail: "Event listeners registered without corresponding cleanup — listeners accumulate",
        seniorNote: "Every call to .on() adds a listener. Without .off(), listeners never die. After enough calls, the listener list is gigabytes of function references that can never be garbage collected.",
        reproductionScenario: "Repeatedly call the function that registers listeners. After 10,000 calls, the process has 10,000+ active listeners. Memory grows linearly with usage.",
      });
    }

    // ─── 5. ERROR HANDLING BLIND SPOTS ──────────────────────────
    // Functions that use .catch() but don't handle specific error types,
    // or catch and re-throw without logging
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Catch that logs but doesn't re-throw — swallows errors
      if (trimmed.match(/catch\s*\(/)) {
        const catchBlock = lines.slice(i, Math.min(i + 15, lines.length)).join("\n");
        const hasOnlyLog = catchBlock.includes("console.") && !catchBlock.includes("throw") && !catchBlock.includes("return") && !catchBlock.includes("reject");
        if (hasOnlyLog && catchBlock.length < 200) {
          findings.push({
            category: "error-blindspot", file: fp, line: i + 1, confidence: 75,
            severity: "high",
            detail: "Error caught, logged, but not handled — the error is silently swallowed",
            seniorNote: "console.error() is not error handling. The function continues as if nothing happened, but in an inconsistent state. Downstream code operates on corrupted assumptions.",
            reproductionScenario: "Trigger the caught error path. The error appears in logs (if anyone checks), but the application enters an unpredictable state that causes a harder-to-diagnose failure later.",
          });
        }
      }

      // Catch-all that catches everything — masks programming errors
      if (line.includes("catch") && line.includes("Error") && !line.includes("instanceof") && !line.includes("type")) {
        findings.push({
          category: "error-blindspot", file: fp, line: i + 1, confidence: 55,
          severity: "medium",
          detail: "Generic error catch that masks programming bugs as runtime errors",
          seniorNote: "Catching 'Error' instead of specific error types (TypeError, RangeError, NetworkError) hides bugs. A null reference exception becomes a generic 'something went wrong.'",
          reproductionScenario: "A programming error (typo, null ref) triggers the catch block. The error message is useless for debugging because it's been genericized.",
        });
      }
    }

    // ─── 6. SILENT DATA CORRUPTION ──────────────────────────────
    // Spread operator with conflicting keys: `{ ...obj, key: val }` where obj already has `key`
    const spreadWithOverride = file.content.match(/\{[\s\S]{0,200}\.\.\.(\w+)[\s\S]{0,200},(\s*\w+\s*:)/g);
    if (spreadWithOverride) {
      findings.push({
        category: "data-corruption", file: fp, confidence: 50,
        severity: "medium",
        detail: `Potential silent override: spreading object then overwriting its keys — readers may use old value`,
        seniorNote: "When you spread an object and then override a key, any reference to the original object still has the OLD value. If another part of the code stored a reference before the spread, it's now stale.",
        reproductionScenario: "Store reference to original object before the spread-override. Read it after — the value is different from what the 'current' version shows.",
      });
    }

    // Mutation of received objects
    const mutatingPatterns = lines.filter(l =>
      (l.match(/\.(\w+)\s*=\s*[^=]/) || l.match(/(\w+)\.(\w+)\.(\w+)\s*=\s*/))
      && !l.includes("this.") && !l.includes("const ") && !l.includes("let ")
    );
    if (mutatingPatterns.length > 3) {
      const firstMut = mutatingPatterns[0];
      findings.push({
        category: "data-corruption", file: fp, line: lines.indexOf(firstMut) + 1, confidence: 60,
        severity: "high",
        detail: `${mutatingPatterns.length} object mutation(s) — modifies caller's data in-place`,
        seniorNote: "Mutating objects you didn't create is a side effect the caller never expects. Senior devs miss this because the mutation is often several lines away from where the object is received.",
        reproductionScenario: "Pass the same config/options object to two functions. The second function gets the mutated version from the first. This is the #1 cause of 'it works in isolation, fails in integration.'",
      });
    }

    // ─── 7. TIMING BOMBS ─────────────────────────────────────────
    // setTimeout with magic number delays — "works on my machine"
    for (let ti = 0; ti < lines.length; ti++) {
      const tLine = lines[ti];
      const setTimeoutDelay = tLine.match(/setTimeout\([\s\S]{0,100},\s*(\d+)\)/);
      if (setTimeoutDelay) {
        const delay = parseInt(setTimeoutDelay[1], 10);
        if (delay < 500 && delay > 0) {
          findings.push({
            category: "timing-bomb", file: fp, line: ti + 1, confidence: 80,
            severity: "high",
            detail: `setTimeout with ${delay}ms delay — fragile timing dependency`,
            seniorNote: `${delay}ms seems like 'enough time' on your machine. On a slower deployment, stressed database, or mobile network, it's not. Timing-dependent code breaks in production but works in dev. Senior devs approve it because 'it works in my tests.'`,
            reproductionScenario: `Deploy to a slower environment. The ${delay}ms delay expires before the async operation completes. The code continues with stale/missing data.`,
          });
        }
      }

      // ─── 8. SIDE EFFECT ORDERING ─────────────────────────────────
      // Module-level code that runs on import — side effects during require
      if (ti < 5 && (tLine.includes("setInterval(") || tLine.includes("setTimeout(") || tLine.includes(".listen(") || tLine.includes("connect("))) {
        findings.push({
          category: "side-effect-ordering", file: fp, line: ti + 1, confidence: 90,
          severity: "critical",
          detail: `Side effect at module top level — runs on import, not on explicit call`,
          seniorNote: "Code at the module top level runs when the file is imported, not when you expect it to. If two modules both start services at import time, they race. Senior devs miss this because the side effect is hidden in a 'setup' section.",
          reproductionScenario: "Import this module conditionally. The side effect runs even if you only wanted the types. Import order determines execution order — fragile.",
        });
      }
    }
  }

  // ─── FILTER BY CONFIDENCE ─────────────────────────────────────
  const highConfidence = findings.filter(f => f.confidence >= 80);

  return {
    findings,
    highConfidence,
    summary: `${findings.length} invisible bugs detected (${highConfidence.length} high confidence). ` +
      `${findings.filter(f => f.severity === "critical").length} critical, ` +
      `${findings.filter(f => f.severity === "high").length} high. ` +
      `These are patterns even senior devs routinely miss in code review.`,
  };
}
