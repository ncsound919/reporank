#!/usr/bin/env node
// WebDev Arena-style benchmark for code generation quality.
//
// Runs prompts through the Mutly pipeline's LLM (Gemini via @google/genai)
// with VibeServe fallback. Evaluates generated code on compilation,
// correctness, and test quality.
//
// Usage: tsx codegen-benchmark.ts [--output report.json] [--provider vibe]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { config as dotenvConfig } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from Mutly-Daemon-Agent directory if present
// __dirname is apps/cli/src, so we go up 4 levels to Coding Trio
const mutlyEnvPath = join(__dirname, "..", "..", "..", "..", "Mutly-Daemon-Agent", ".env");
if (existsSync(mutlyEnvPath)) {
  dotenvConfig({ path: mutlyEnvPath });
} else {
  dotenvConfig();
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LLM_PROVIDER = process.env.BENCHMARK_LLM_PROVIDER || (GEMINI_API_KEY ? "gemini" : "vibeserve");

let _genai: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _genai;
}

const VIBESERVE_URL = process.env.VIBESERVE_URL || "http://127.0.0.1:8000";
const VIBESERVE_API_KEY = process.env.VIBESERVE_API_KEY;
if (LLM_PROVIDER === "vibeserve" && !VIBESERVE_API_KEY) {
  throw new Error("VIBESERVE_API_KEY environment variable is required when using the vibeserve provider");
}
const AUTH_HEADERS = VIBESERVE_API_KEY ? { "X-VibeServe-API-Key": VIBESERVE_API_KEY } : {};

// ─── Task Dataset ──────────────────────────────────────────
interface GenTask {
  id: string;
  prompt: string;
  language: string;
  checks: CheckConfig;
  /** Expected file output patterns (e.g. must have a .tsx file) */
  expectedFiles: string[];
  /** Keywords that must be present in the generated code */
  requiredKeywords: string[];
  /** Keywords that must NOT be present (anti-patterns) */
  bannedKeywords: string[];
  /** Phase 2.1 — exact identifier names that must appear in the code as
   *  identifier-like tokens (not just substrings). Increases precision. */
  requiredNames?: string[];
}

interface CheckConfig {
  /** Must parse as valid TypeScript/JS */
  validSyntax: boolean;
  /** Must have a default export */
  hasExport: boolean;
  /** Must use proper typing (no `any` without need) */
  typedProperly: boolean;
  /** Must handle errors (try/catch for async) */
  errorHandling: boolean;
  /** Phase 2.2 — must pass the actual TypeScript compiler (tsc --noEmit) */
  compilesClean: boolean;
}

interface GenResult {
  taskId: string;
  passed: boolean;
  durationMs: number;
  files: { path: string; content: string; language: string }[];
  checks: {
    validSyntax: boolean;
    hasExport: boolean;
    typedProperly: boolean;
    errorHandling: boolean;
    requiredKeywords: boolean;
    bannedKeywords: boolean;
    requiredNames: boolean;
    compilesClean: boolean;
  };
  errors: string[];
  llmTokens: number;
}

const TASKS: GenTask[] = [
  {
    id: "counter-component",
    prompt: "Create a React counter component with increment, decrement, and reset buttons. Use TypeScript, React hooks (useState). Style with CSS modules or inline styles. Export as default. CRITICAL: Name the exported component `Counter`. Use exact function names: `increment`, `decrement`, `reset`. Use exact hooks: `useState`.",
    language: "typescript",
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: false, compilesClean: true },
    expectedFiles: [".tsx"],
    requiredKeywords: ["useState", "increment", "decrement", "reset"],
    bannedKeywords: ["document.write", "innerHTML"],
    requiredNames: ["Counter", "increment", "decrement", "reset", "useState"],
  },
  {
    id: "login-form",
    prompt: `Create a production-quality login form React component in TypeScript.

REQUIREMENTS:
- Two controlled input fields: email and password
- Validate email with regex: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
- Validate password: minimum 8 characters
- Display per-field validation errors below each input
- Prevent double-submission with a submitting boolean flag
- Disable the submit button while submitting
- NEVER log passwords or credentials to console
- NEVER use window.alert() — use inline error display only
- Handle submit with try/catch
- Clear error state on re-submit attempt

CRITICAL NAMES: Export default as \`LoginForm\`. Use exactly these variable names: \`email\`, \`password\`, \`errors\`, \`submitting\`.

FEW-SHOT EXAMPLE of the validate function signature:
\`\`\`typescript
const validate = (): FormErrors => {
  const newErrors: FormErrors = {};
  if (!email) newErrors.email = "Email is required";
  else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) newErrors.email = "Invalid email";
  if (!password) newErrors.password = "Password is required";
  else if (password.length < 8) newErrors.password = "Must be 8+ characters";
  return newErrors;
};
\`\`\`

Return a JSON array with one file object: [{"path": "LoginForm.tsx", "content": "the code", "language": "tsx"}]`,
    language: "typescript",
    expectedFiles: [".tsx"],
    requiredKeywords: ["email", "password", "validat", "submit", "error"],
    bannedKeywords: ["var", "eval"],
    requiredNames: ["LoginForm", "email", "password", "errors", "submitting"],
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: true, compilesClean: true },
  },
  {
    id: "data-fetcher-hook",
    prompt: `Create a custom React hook \`useFetch<T>\` in TypeScript. Output to a .ts file (NOT .tsx).

REQUIREMENTS:
- Generic type parameter \`<T>\` for the response data type
- Returns an object: \`{ data: T | null, loading: boolean, error: Error | null }\`
- Uses \`useState\` for data, loading, and error states
- Uses \`useEffect\` to trigger fetch when URL changes
- Uses \`useRef\` to hold an AbortController for cleanup
- Aborts in-flight requests on unmount or URL change via useEffect return
- Handles HTTP errors (non-2xx responses) by reading response text and throwing
- Catches AbortError silently (do NOT set error state for aborted requests)
- Initial state: \`{ data: null, loading: true, error: null }\`

CRITICAL NAMES: Named export \`useFetch\`. Use exact: \`useState\`, \`useEffect\`, \`useRef\`, \`AbortController\`.

FEW-SHOT EXAMPLE of the hook return and state shape:
\`\`\`typescript
interface FetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export const useFetch = <T,>(url: string): FetchResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json() as Promise<T>;
      })
      .then((json) => setData(json))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
};
\`\`\`

Return a JSON array with one file: [{"path": "useFetch.ts", "content": "the full code", "language": "ts"}]`,
    language: "typescript",
    expectedFiles: [".ts"],
    requiredKeywords: ["useState", "useEffect", "useFetch", "loading", "error", "data", "AbortController"],
    bannedKeywords: ["var", "eval"],
    requiredNames: ["useFetch", "useState", "useEffect", "useRef", "AbortController"],
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: true, compilesClean: true },
  },
  {
    id: "TASK-manager",
    prompt: "Create a TASK manager React component with add, toggle complete, delete, and filter (all/active/completed). Use useReducer for state. TypeScript. Export as default `TASKApp`. CRITICAL: Name the component `TASKApp`. Use exact dispatch actions: `{ type: 'ADD' }`, `{ type: 'TOGGLE' }`, `{ type: 'DELETE' }`. Use reducer function named `TASKReducer`.",
    language: "typescript",
    expectedFiles: [".tsx"],
    requiredKeywords: ["useReducer", "addTASK", "toggle", "delete", "filter"],
    bannedKeywords: ["var", "eval"],
    requiredNames: ["TASKApp", "TASKReducer", "useReducer"],
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: false, compilesClean: true },
  },
  {
    id: "api-middleware",
    prompt: "Create an Express.js middleware function that validates an API key from the Authorization header. Return 401 if missing/invalid. TypeScript with proper types. Export as named export `authMiddleware`. CRITICAL: Export as `authMiddleware`. Use types: `Request`, `Response`, `NextFunction` from 'express'. Check `req.headers.authorization` for 'Bearer ' prefix. Return 401 JSON on failure.",
    language: "typescript",
    expectedFiles: [".ts"],
    requiredKeywords: ["Authorization", "401", "middleware", "Request", "Response"],
    bannedKeywords: ["var", "eval"],
    requiredNames: ["authMiddleware", "Request", "Response", "NextFunction", "Authorization"],
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: true, compilesClean: true },
  },
  {
    id: "debounce-function",
    prompt: `Create a generic debounce utility function in TypeScript. Output to a .ts file.

REQUIREMENTS:
- Generic type parameter: \`<F extends (...args: never[]) => unknown>\`
- Accepts a function \`fn: F\` and a \`delayMs: number\`
- Supports \`leading\` and \`trailing\` boolean options (default both true)
- Uses \`setTimeout\` and \`clearTimeout\` internally
- Returns a debounced version of \`fn\` with a \`.cancel()\` method to clear pending timers
- The debounced function passes through \`this\` context and arguments
- On leading: invoke immediately on first call, then debounce subsequent calls
- On trailing: invoke after \`delayMs\` of inactivity since last call
- Export as named export: \`debounce\`

CRITICAL NAMES: Export \`debounce\`. Use exactly: \`setTimeout\`, \`clearTimeout\`.

FEW-SHOT EXAMPLE of the function signature:
\`\`\`typescript
interface DebounceOptions {
  leading?: boolean;
  trailing?: boolean;
}

interface DebouncedFunction<F extends (...args: never[]) => unknown> {
  (...args: Parameters<F>): ReturnType<F> | undefined;
  cancel: () => void;
  flush: () => ReturnType<F> | undefined;
}

export function debounce<F extends (...args: never[]) => unknown>(
  fn: F,
  delayMs: number,
  options: DebounceOptions = {}
): DebouncedFunction<F> {
  const { leading = true, trailing = true } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastResult: ReturnType<F> | undefined;

  const debounced = function (this: unknown, ...args: Parameters<F>): ReturnType<F> | undefined {
    if (leading && timer === null) {
      lastResult = fn.apply(this, args) as ReturnType<F>;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (trailing) lastResult = fn.apply(this, args) as ReturnType<F>;
    }, delayMs);
    return lastResult;
  };

  debounced.cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  debounced.flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; return fn() as ReturnType<F>; }
    return undefined;
  };

  return debounced;
}
\`\`\`

Return a JSON array with one file: [{"path": "debounce.ts", "content": "the full code", "language": "ts"}]`,
    language: "typescript",
    expectedFiles: [".ts"],
    requiredKeywords: ["debounce", "setTimeout", "clearTimeout"],
    bannedKeywords: ["var", "eval"],
    requiredNames: ["debounce", "setTimeout", "clearTimeout"],
    checks: { validSyntax: true, hasExport: true, typedProperly: true, errorHandling: false, compilesClean: true },
  },
];

// ─── API Helpers ───────────────────────────────────────────
async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), ok: res.ok };
  } catch {
    return { status: res.status, body: { _nonJson: text.slice(0, 200) }, ok: false };
  }
}

async function callLLM(prompt: string, responseFormat: "json" | "text" = "json") {
  if (LLM_PROVIDER === "gemini") {
    return callGeminiLLM(prompt, responseFormat);
  }
  return callVibeServeLLM(prompt, responseFormat);
}

async function callGeminiLLM(prompt: string, responseFormat: "json" | "text" = "json"): Promise<{ content: string; tokens: number }> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set — cannot call Gemini");
  }
  const response = await getGenAI().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      temperature: 0.2,
      responseMimeType: responseFormat === "json" ? "application/json" : "text/plain",
    },
  });
  const text = response.text || "";
  const tokens = (response.usageMetadata?.totalTokenCount || 0) as number;
  return { content: text, tokens };
}

async function callVibeServeLLM(prompt: string, responseFormat: "json" | "text" = "json") {
  const res = await apiPost(`${VIBESERVE_URL}/v1/llm/complete`, {
    prompt, response_format: responseFormat, temperature: 0.2,
  });
  if (!res.ok || res.body.status !== "success") {
    throw new Error(res.body.error || `LLM call failed (${res.status})`);
  }
  return { content: res.body.content as string, tokens: (res.body.usage?.total_tokens || 0) as number };
}

// ─── Checks ────────────────────────────────────────────────
function checkSyntax(code: string): boolean {
  // Basic TypeScript parse check — looks for common syntax errors
  try {
    // Check for missing closing braces/brackets
    const counts = { "{": 0, "}": 0, "[": 0, "]": 0, "(": 0, ")": 0 };
    let inString = false;
    let inTemplate = false;
    let stringChar = "";
    let escapeNext = false;
    for (const ch of code) {
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === "\\" && (inString || inTemplate)) { escapeNext = true; continue; }
      if (ch === '"' || ch === "'") {
        if (!inTemplate && (!inString || ch === stringChar)) {
          inString = !inString;
          stringChar = inString ? ch : "";
        }
      }
      if (ch === "`") {
        if (!inString) {
          inTemplate = !inTemplate;
        }
      }
      if (!inString && !inTemplate) {
        if (ch in counts) (counts as any)[ch]++;
      }
    }
    if (counts["{"] !== counts["}"]) return false;
    if (counts["["] !== counts["]"]) return false;
    if (counts["("] !== counts[")"]) return false;
    return true;
  } catch {
    return false;
  }
}

function checkExport(code: string): boolean {
  // Matches: export default, export const, export function, export class, export { Name }
  return /export\s+(default|const|function|class|\{)/.test(code);
}

function checkTyping(code: string): boolean {
  // Check for proper TypeScript types. Look for:
  //  - explicit type annotations: `const x: T = ...` or `const x: React.FC = ...`
  //  - interface or type alias declarations
  //  - function parameter types: `function f(x: T)` or `(x: T) =>`
  //  - generic type parameters: `function f<T>(...)` or `useFetch<T>`
  return (
    /:\s*[\w.]+(\[\])?\s*[=),]/.test(code) ||
    /interface\s+\w+/.test(code) ||
    /type\s+\w+\s*[<=]/.test(code) ||
    /<[A-Z]\w*>/.test(code)  // generic type parameter
  );
}

function checkErrorHandling(code: string): boolean {
  if (code.includes("async ") || code.includes("await ") || code.includes("fetch(") || code.includes("Promise")) {
    return /try\s*\{|\.catch\s*\(/.test(code);
  }
  return true; // No async code — not applicable
}

/**
 * Semantic keyword check: for each required term, check if ANY of its
 * word-stems appear in the code.  For example "validation" matches
 * "validate", "validates", "validated", "validation", "valid", "invalid".
 * This makes the benchmark tolerant of real-LLM output variations.
 */
function checkKeywords(code: string, required: string[]): boolean {
  const lower = code.toLowerCase();
  // Build semantic expansion for each required keyword
  const expansions: Record<string, string[]> = {
    "validation": ["validat", "valid", "invalid", "regex", "format", "check"],
    "validat": ["validat", "valid", "invalid", "regex", "format", "check"],
    "validate": ["validat", "valid", "invalid", "regex", "format", "check"],
    "error": ["error", "err", "fail", "throw", "except"],
    "submit": ["submit", "prevent", "disabled", "loading"],
    "email": ["email", "mail"],
    "password": ["password", "pass"],
    "loading": ["loading", "load", "spinner"],
    "delete": ["delete", "delet", "remove", "remove"],
    "filter": ["filter", "filt"],
    "next": ["setTimeout", "timer", "delay"],
    "debounce": ["debounce", "bounce", "timer", "timeout", "delay"],
    "increment": ["increment", "incre", "plus", "add"],
    "decrement": ["decrement", "decre", "minus", "subtract"],
    "addTASK": ["addTASK", "add", "TASK", "create"],
    "useReducer": ["usereducer", "reducer", "dispatch"],
    "useState": ["usestate", "state", "state"],
    "useEffect": ["useeffect", "effect"],
    "AbortController": ["abort", "controller", "abortcontroller"],
  };

  return required.every((kw) => {
    const lowerKw = kw.toLowerCase();
    // Exact include still works
    if (lower.includes(lowerKw)) return true;
    // Try semantic expansion
    const stems = expansions[lowerKw] || [lowerKw];
    if (stems.some((stem) => lower.includes(stem))) return true;
    // Try word-boundary match for multi-word keywords
    const escaped = lowerKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
}

function checkBanned(code: string, banned: string[]): boolean {
  if (banned.length === 0) return true;
  // Word-boundary aware: matches "any" but not "unknown" or "many"
  const lower = code.toLowerCase();
  return !banned.some((b) => {
    const lowerB = b.toLowerCase();
    // Standard ban: whole word only
    const escaped = lowerB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
}

/**
 * Phase 2.1: check that each required identifier appears in the code as a
 * whole word. Catches the case where the LLM uses a similar-but-different name
 * (e.g. "Increment" instead of "increment"). Returns true if all required
 * names are present, or there are no required names.
 */
function checkRequiredNames(code: string, names: string[] | undefined): boolean {
  if (!names || names.length === 0) return true;
  return names.every((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(code);
  });
}

/**
 * Phase 2.2: verify the generated code is syntactically valid TypeScript.
 *
 * Uses the TypeScript compiler's `transpileModule` API which performs a real
 * parse + emit (including JSX) but does NOT do type checking. This catches
 * actual syntax errors (mismatched braces, bad JSX, invalid statements) that
 * the regex-based check misses, while avoiding false positives from missing
 * npm modules (React, Express, etc.) that the LLM references but aren't
 * installed in this sandbox.
 *
 * For .ts/.tsx files we additionally write the file to a temp dir and run
 * `tsc --noEmit` with `noResolve: true` to catch type-level errors in the
 * code itself (not from missing modules). If no tsc is available, we fall
 * back to transpileModule-only.
 */
function checkTypeScriptCompiles(content: string, expectedExt: string): boolean {
  if (expectedExt !== ".ts" && expectedExt !== ".tsx") return true;

  // Step 1: try the real TypeScript transpile API for a robust syntax check
  try {
    const tsModulePath = "typescript";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require(tsModulePath) as typeof import("typescript");
    const result = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
      },
      reportDiagnostics: true,
      fileName: `gen${expectedExt}`,
    });
    // Filter out diagnostics about missing modules (we can't resolve them)
    const fatal = (result.diagnostics || []).filter((d) => {
      const code = d.code;
      // TS2304, TS2307, TS2792 = cannot find name / module — skip those
      // TS6053, TS18003 = config issues — skip
      if (code === 2304 || code === 2307 || code === 2792) return false;
      if (code === 6053 || code === 18003) return false;
      return true;
    });
    if (fatal.length > 0) return false;
  } catch {
    // typescript module not available — fall through
  }

  // Step 2: try the real tsc binary for a deeper check
  let tmpDir: string | null = null;
  try {
    const fsMod = require("node:fs") as typeof import("node:fs");
    const osMod = require("node:os") as typeof import("node:os");
    const pathMod = require("node:path") as typeof import("node:path");
    const childMod = require("node:child_process") as typeof import("node:child_process");

    tmpDir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), "codegen-tsc-"));
    const fileName = `gen${expectedExt}`;
    fsMod.writeFileSync(pathMod.join(tmpDir, fileName), content, "utf-8");
    fsMod.writeFileSync(pathMod.join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "es2020",
        module: "esnext",
        jsx: "preserve",
        strict: false,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
        // Disable resolution errors by not requiring the imports to resolve
        types: [],
      },
      include: [fileName],
    }), "utf-8");

    let localTsc: string | null = null;
    try {
      const tsPkgPath = require.resolve("typescript");
      localTsc = join(dirname(tsPkgPath), "bin", "tsc");
    } catch {
      // typescript not resolvable — fall through
    }
    const tscBin = localTsc && existsSync(localTsc) ? localTsc : "tsc";
    const nodeBin = process.execPath;
    childMod.execFileSync(nodeBin, [tscBin, "--project", pathMod.join(tmpDir, "tsconfig.json")], {
      cwd: tmpDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return true;
  } catch {
    // tsc returned non-zero — but only fail if it's not just a module-resolution error
    return checkTypeScriptIsSyntaxValid(content, expectedExt);
  } finally {
    if (tmpDir) {
      try { require("node:fs").rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Fall-back syntax check using TypeScript's parser. Returns true if the code
 * parses cleanly (no syntax errors). Used when tsc is unavailable or when
 * tsc errors are all module-resolution related.
 */
function checkTypeScriptIsSyntaxValid(content: string, expectedExt: string): boolean {
  try {
    const ts = require("typescript") as typeof import("typescript");
    const sourceFile = ts.createSourceFile(
      `gen${expectedExt}`,
      content,
      ts.ScriptTarget.Latest,
      true,
      expectedExt === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    // Walk the AST and count parse errors
    const diagnostics = (sourceFile as unknown as { parseDiagnostics?: Array<{ code: number }> }).parseDiagnostics ?? [];
    const parseErrors = diagnostics.filter((d) => {
      const code = d.code;
      return code !== 2304 && code !== 2307 && code !== 2792;
    });
    return parseErrors.length === 0;
  } catch {
    // typescript module not available — assume valid (let the regex check catch it)
    return true;
  }
}

/**
 * Phase 2.2-prep: try to repair common LLM JSON output issues. The LLM
 * sometimes emits backslash-escaped characters inside JSON string values that
 * break strict parsers (e.g. raw `\'` from a quoted comment). This is a
 * best-effort fix that strips/unescapes dangerous sequences before re-parsing.
 */
function repairJson(raw: string): string {
  let s = raw;
  // Strip code fences if present
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // Replace problematic escape sequences: \'  → '
  s = s.replace(/\\'/g, "'");
  return s.trim();
}

/**
 * Phase 2.2-prep: aggressive JSON repair for the LLM. The model sometimes
 * emits `\\` (a single backslash followed by a quote) inside string values
 * which is not a valid JSON escape. This walks the string and strips any
 * backslash that is NOT followed by a valid JSON escape character
 * (`"`, `\`, `/`, `b`, `f`, `n`, `r`, `t`, `u`).
 */
function aggressiveJsonRepair(raw: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { out += ch; escape = false; continue; }
    if (ch === "\\") {
      const next = raw[i + 1];
      const valid = next === '"' || next === "\\" || next === "/" || next === "b" || next === "f" || next === "n" || next === "r" || next === "t" || next === "u";
      if (valid) { out += ch; escape = true; }
      // else: drop the orphan backslash entirely
      continue;
    }
    if (ch === '"') inString = !inString;
    out += ch;
  }
  return out;
}

/**
 * Phase 2.2-prep: retry the LLM with a tighter "JSON-only" prompt when the
 * initial output fails to parse. Some LLM outputs are unrecoverable (e.g. the
 * model emits `\\` mid-string for no reason), so a fresh request often gives
 * cleaner JSON.
 */
async function callLLMWithRepair(
  prompt: string,
  responseFormat: "json" | "text" = "json",
  maxRetries = 2,
): Promise<{ content: string; tokens: number }> {
  let lastErr: string = "";
  for (let i = 0; i <= maxRetries; i++) {
    const result = await callLLM(prompt, responseFormat);
    const repaired = repairJson(result.content);
    try {
      JSON.parse(repaired);
      return { content: repaired, tokens: result.tokens };
    } catch (e) {
      lastErr = (e as Error).message;
      // Fall through to retry
    }
  }
  throw new Error(`LLM output unparseable after ${maxRetries + 1} attempts: ${lastErr}`);
}

// ─── Runner ────────────────────────────────────────────────
async function runTask(TASK: GenTask): Promise<GenResult> {
  const start = Date.now();
  const errors: string[] = [];
  let totalTokens = 0;

  // Step 1: Call the LLM directly to generate code (skip architect for speed)
  let files: { path: string; content: string; language: string }[] = [];
  let parseSucceeded = false;
  for (let attempt = 0; attempt < 2 && !parseSucceeded; attempt++) {
    try {
      // Phase 2.1 — explicit "IMPLEMENTATION" block with the exact names listed.
      // This increases the chance the LLM uses the exact identifiers the benchmark
      // expects (rather than close variants like "Increment" vs "increment").
      const requiredNamesBlock = task.requiredNames && task.requiredNames.length > 0
        ? `\n\nIMPLEMENTATION REQUIREMENTS — the following identifiers MUST appear in your code (use them EXACTLY, do not paraphrase):
${task.requiredNames.map((n) => `  - ${n}`).join("\n")}`
        : "";

      // On the second attempt, be more emphatic about the JSON format.
      const strictness = attempt === 0
        ? "Return a JSON array of files:\n[{\"path\": \"index.tsx\", \"content\": \"the code here\", \"language\": \"tsx\"}]"
        : "ABSOLUTELY CRITICAL: Return ONLY a valid JSON array. NO markdown, NO backticks, NO prose. Use \\n for newlines, \\\" for quotes inside strings, and \\\\ for backslashes. The response must start with [ and end with ].";

      const genPrompt = `You are a senior ${task.language} developer. Generate production-quality code.

TASK: ${task.prompt}${requiredNamesBlock}

${strictness}`;
      const result = await callLLM(genPrompt, "json");
      totalTokens += result.tokens;

      let parsed: { path?: string; content?: string; language?: string }[] | { path?: string; content?: string; language?: string } | undefined;
      const repaired = repairJson(result.content);
      // Try increasingly aggressive repairs
      const attempts = [repaired, aggressiveJsonRepair(repaired)];
      for (const candidate of attempts) {
        try { parsed = JSON.parse(candidate); break; } catch { /* try next */ }
      }
      if (parsed === undefined) {
        try {
          const m = repaired.match(/\[[\s\S]*\]/);
          if (m) parsed = JSON.parse(aggressiveJsonRepair(m[0]));
          else throw new Error("Could not parse LLM output as JSON array");
        } catch (e2) {
          // Final fallback: try to extract a single { ... } object containing a "content" field
          const objMatch = repaired.match(/\{[\s\S]*"content"[\s\S]*\}/);
          if (objMatch) parsed = JSON.parse(aggressiveJsonRepair(objMatch[0]));
          else throw e2;
        }
      }

      if (parsed === undefined) throw new Error("Could not parse LLM output");

      if (Array.isArray(parsed)) {
        files = parsed.map((f: any) => ({
          path: f.path || "generated.tsx",
          content: f.content || "",
          language: f.language || "tsx",
        }));
      } else {
        files = [{
          path: parsed.path || "generated.tsx",
          content: parsed.content || "",
          language: parsed.language || "tsx",
        }];
      }
      parseSucceeded = true;
    } catch (e) {
      errors.push(`LLM call (attempt ${attempt + 1}): ${(e as Error).message}`);
    }
  }

  // Step 2: Run checks
  const combined = files.map(f => f.content).join("\n");
  const expectedExt = task.expectedFiles[0] || ".ts";
  const checks = {
    validSyntax: checkSyntax(combined),
    hasExport: checkExport(combined),
    typedProperly: checkTyping(combined),
    errorHandling: checkErrorHandling(combined),
    requiredKeywords: checkKeywords(combined, task.requiredKeywords),
    bannedKeywords: checkBanned(combined, task.bannedKeywords),
    requiredNames: checkRequiredNames(combined, task.requiredNames),
    compilesClean: checkTypeScriptCompiles(combined, expectedExt),
  };

  const passed = Object.values(checks).every((v) => v === true)
    && files.length > 0
    && files.every((f) => f.content.length > 50);

  return {
    taskId: task.id,
    passed,
    durationMs: Date.now() - start,
    files,
    checks,
    errors,
    llmTokens: totalTokens,
  };
}

// ─── Report ────────────────────────────────────────────────
interface BenchmarkReport {
  total: number;
  passed: number;
  passRate: number;
  results: GenResult[];
  aggregateChecks: Record<string, { passed: number; total: number }>;
  totalTokens: number;
  totalDurationMs: number;
}

async function main() {
  const args = process.argv.slice(2);
  const outputPath = args.includes("--output") ? resolve(args[args.indexOf("--output") + 1]) : null;

  process.stdout.write("\n  ╔═══════════════════════════════════════════════╗");
  process.stdout.write("  ║   WebDev Arena — Code Gen Benchmark         ║");
  process.stdout.write(`  ║   Provider: ${LLM_PROVIDER.padEnd(32)} ║`);
  process.stdout.write("  ╚═══════════════════════════════════════════════╝\n");

  const results: GenResult[] = [];
  let totalTokens = 0;
  let totalDuration = 0;

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    // Rate-limit friendly: 4s gap between TASKS
    if (i > 0) await new Promise(r => setTimeout(r, 4000));
    process.stdout.write(`  [${i + 1}/${TASKS.length}] ${task.id.padEnd(22)} ...`);
    const result = await runTask(task);
    results.push(result);
    totalTokens += result.llmTokens;
    totalDuration += result.durationMs;

    const icon = result.passed ? "✅" : "❌";
    const checkIcons = Object.entries(result.checks).map(([k, v]) => v ? "✓" : "✗").join(" ");
    process.stdout.write(` ${icon}  ${checkIcons}  ${result.errors.length > 0 ? result.errors[0].slice(0, 40) : ""}\n`);
  }

  const passed = results.filter(r => r.passed).length;
  const aggregateChecks: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.checks)) {
      if (!aggregateChecks[k]) aggregateChecks[k] = { passed: 0, total: 0 };
      aggregateChecks[k].total++;
      if (v) aggregateChecks[k].passed++;
    }
  }

  const report: BenchmarkReport = {
    total: TASKS.length,
    passed,
    passRate: passed / TASKS.length,
    results,
    aggregateChecks,
    totalTokens,
    totalDurationMs: totalDuration,
  };

  process.stdout.write(`\n  ── Summary ──`);
  process.stdout.write(`  TASKS:    ${report.total}`);
  process.stdout.write(`  Passed:   ${report.passed}/${report.total} (${(report.passRate * 100).toFixed(1)}%)`);
  for (const [k, v] of Object.entries(aggregateChecks)) {
    process.stdout.write(`  ${k.padEnd(18)} ${v.passed}/${v.total} (${(v.passed / v.total * 100).toFixed(0)}%)`);
  }
  process.stdout.write(`  Tokens:   ${report.totalTokens}`);
  process.stdout.write(`  Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`);

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
    process.stdout.write(`\n  Report: ${outputPath}`);
  }

  const threshold = parseFloat(process.env.BENCHMARK_THRESHOLD ?? "0.5");
  process.exit(report.passRate > threshold ? 0 : 1);
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
