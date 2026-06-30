import type { Finding } from "./review_scanner";

interface HeuristicRule {
  type: string;
  category: Finding["category"];
  severity: Finding["severity"];
  pattern: RegExp;
  description: string;
  recommendation: string;
  confidence: number;
}

function rule(
  type: string,
  category: Finding["category"],
  severity: Finding["severity"],
  pattern: RegExp,
  description: string,
  recommendation: string,
  confidence: number,
): HeuristicRule {
  return { type, category, severity, pattern, description, recommendation, confidence };
}

const RULES = [
  rule("code-injection", "security", "critical", /\bnew\s+Function\s*\((?!\s*(?:['"][^'"]*['"]\s*(?:,\s*)?)*\s*\))/g, "new Function() compiles and executes arbitrary code from a string", "Use a static function or a sandboxed VM (vm2/isolated-vm) with strict input validation", 0.95),
  rule("code-injection", "security", "critical", /\beval\s*\(/g, "eval() executes arbitrary code from a string", "Replace with a safe parser; if dynamic evaluation is required, use a sandboxed VM", 0.99),
  rule("sql-injection", "security", "critical", /(?:query|execute|exec)\s*\(\s*[`"'][^`"']*\$\{[^}]+\}[^`"']*[`"']/g, "User input interpolated into a SQL string (template literal in query/exec)", "Use a parameterised query with placeholders ($1, ?, :name) and a values array", 0.9),
  rule("sql-injection", "security", "critical", /(?:query|execute|exec)\s*\(\s*["'][^"']*["']\s*\+\s*[A-Za-z_]/g, "String concatenation with user input passed to query/exec", "Use a parameterised query instead of string concatenation", 0.85),
  rule("xss", "security", "high", /res\.send\s*\(\s*[`"'][^`"']*\$\{[^}]*(?:req\.|input|user|comment)/g, "Unsanitized user input rendered directly in HTTP response", "Use a templating engine with auto-escaping (e.g. EJS, Handlebars) or sanitise with DOMPurify", 0.85),
  rule("path-traversal", "security", "high", /(?:readFile|createReadStream)\s*\(\s*(?:path\.(?:join|resolve))?\s*\([^)]*req\.|.*\+.*req\./g, "File path constructed from user input without validation", "Validate the resolved path stays inside the intended root using path.resolve + startsWith check", 0.75),
  rule("weak-crypto", "security", "medium", /\b(?:hashlib\.md5|createHash\s*\(\s*["']md5["']\s*\)|CryptoJS\.MD5)/g, "MD5 is cryptographically broken", "Use SHA-256 for non-password hashing; use bcrypt/argon2/scrypt for password hashing", 0.95),
  rule("weak-crypto", "security", "medium", /\b(?:hashlib\.sha1|createHash\s*\(\s*["']sha1["']\s*\))/g, "SHA-1 is deprecated for security use", "Use SHA-256 or SHA-3", 0.9),
  rule("insecure-random", "security", "medium", /(?=.*\b(?:token|secret|session|nonce|key)\b).*?\b(?:Math\.random|random\.random|random\.randint)\s*\(\s*\)/gi, "Math.random/random is not cryptographically secure for token generation", "Use crypto.randomBytes() (Node), secrets module (Python), or crypto.SecureRandom (Java)", 0.7),
  rule("jwt-alg-none", "security", "critical", /jwt\.verify\s*\([^)]*,\s*['"][^'"]+['"]\s*\)/g, "jwt.verify without algorithms option allows the alg=none attack", "Pass { algorithms: ['HS256'] } (or your expected algorithm) as the third argument", 0.85),
  rule("redos", "security", "high", /\(\?:\?\.\*\?\)[+*]/g, "Nested quantifier pattern (e.g. (a+)+, (.*)*) can cause catastrophic backtracking", "Refactor the regex to avoid nested quantifiers; benchmark with a ReDoS tool", 0.6),
  rule("hardcoded-secret", "security", "high", /(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|sk_live_[0-9A-Za-z]{24,}|AKIA[0-9A-Z]{16})/g, "Hardcoded API key or credential detected in source", "Move secrets to environment variables; rotate the exposed credential immediately", 0.98),
  rule("hardcoded-secret", "security", "high", /(?:postgresql|mysql|mongodb|redis):\/\/[^\s'"]+:[^\s'"]+@/g, "Database connection string with embedded password", "Move credentials to env vars; use a secrets manager (Vault, AWS Secrets Manager)", 0.9),
  rule("cors-misconfiguration", "security", "high", /cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/g, "CORS configured with wildcard origin", "Whitelist specific allowed origins; never use '*' with credentials:true", 0.95),
  rule("prototype-pollution", "security", "high", /for\s*\(\s*(?:const|let|var)\s+\w+\s+(?:of|in)\s+Object\.keys/g, "Recursive merge over Object.keys may allow prototype pollution", "Guard against __proto__, constructor, prototype keys; use Object.create(null) or structuredClone", 0.5),
  rule("timing-attack", "security", "medium", /return\s+\w+\s*===\s*\w+\s*;.*(?:token|secret|password|key)/gis, "Plain string comparison of secret values — vulnerable to timing attacks", "Use crypto.timingSafeEqual (Node) or hmac.compare_digest (Python)", 0.6),

  rule("any-type-abuse", "quality", "medium", /:\s*any\b/g, "Use of `any` defeats TypeScript type safety", "Replace with proper types, generics, or `unknown` for values that need narrowing", 0.85),
  rule("debug-code", "quality", "low", /console\.(log|debug)\s*\(/g, "console.log/debug statements should be removed from production code", "Use a proper logger (pino, winston, structlog) with appropriate log levels", 0.5),
  rule("TASK-comment", "maintainability", "low", /\/\/\s*(?:TASK|FIX_NOW|HACK|XXX)\b/gi, "TASK/FIX_NOW marker indicates incomplete work or a known issue", "Track in your issue tracker and link from the comment, or implement the fix", 0.95),
  rule("FIX_NOW-known-bug", "maintainability", "medium", /\/\/\s*FIX_NOW\b/gi, "FIX_NOW comment indicates a known bug", "File an issue and link from the comment; prioritise the fix", 0.9),
  rule("missing-test-coverage", "maintainability", "low", /^export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*[:{][^}]*\}[^}]*$/gm, "Exported function with no obvious test file reference", "Add a test file (e.g. foo.test.ts) covering the happy path and key edge cases", 0.2),

  rule("n-plus-1-query", "performance", "high", /for\s*\([^)]+\)\s*\{[^}]*await\s+(?:db|prisma|sequelize|knex|query)\./gs, "Database query inside a for-loop — likely N+1", "Use a single query with IN clause, JOIN, or include() to fetch all rows at once", 0.7),
  rule("blocking-event-loop", "performance", "high", /(?:readFileSync|writeFileSync|execSync|spawnSync)\s*\(/g, "Synchronous I/O blocks the event loop in async contexts", "Use the async variant (readFile, writeFile, exec) in request handlers", 0.6),
  rule("quadratic-complexity", "performance", "medium", /if\s+\w+\s+in\s+\w+\s*[\[.]/g, "Lookup in an array inside a loop — O(n²) pattern", "Convert to a Set for O(1) lookups, or restructure the algorithm", 0.5),

  rule("mutable-default-argument", "quality", "high", /def\s+\w+\s*\([^)]*=\s*\[\s*\]\s*\)/g, "Mutable list as default argument (Python gotcha — shared across calls)", "Use def f(x=None): x = x or []  or  x = list(x) if x else []", 0.95),
  rule("resource-leak", "quality", "high", /fs\.openSync\s*\(/g, "File handle opened with fs.openSync — must be paired with fs.closeSync", "Use fs.promises.open() with try/finally, or wrap in a context manager", 0.7),
  rule("race-condition", "quality", "high", /let\s+\w+\s*=\s*0[\s\S]{0,200}const\s+\w+\s*=\s*\w+[\s\S]{0,200}await[\s\S]{0,200}=.*\+.*1/gs, "Read-modify-write on shared state with await in the middle — race condition", "Use atomic operations, a mutex, or move the increment into a single non-interleaved expression", 0.45),
  rule("async-foreach-bug", "quality", "medium", /\.forEach\s*\(\s*async\s*\(/g, "forEach with async callback — promises are not awaited", "Use for...of with await, or Promise.all(items.map(asyncFn))", 0.95),
  rule("callback-hell", "maintainability", "medium", /function\s*\([^)]*\)\s*\{[^}]*function\s*\([^)]*\)\s*\{[^}]*function\s*\(/gs, "Triple-nested callbacks (Pyramid of Doom)", "Refactor to async/await or Promises; extract helpers to flatten the call graph", 0.6),
  rule("deep-nesting", "maintainability", "low", /^(\s*)(\s*\2){5,}\S/gm, "Six or more levels of indentation — readability hit", "Use early returns (guard clauses) or extract nested logic into named functions", 0.5),
  rule("missing-null-check", "quality", "medium", /await\s+\w+\.find(?:Unique|First|One)\s*\([^)]*\)\s*;[\s\S]{0,300}\.\w+\.\w+\(/g, "Result of findUnique/findFirst used without null check", "Guard with `if (!result) return ...` or use optional chaining with explicit handling", 0.4),
  rule("no-error-handling", "quality", "medium", /export\s+async\s+function\s+\w+\s*\([^)]*\)\s*:\s*Promise<[^>]+>\s*\{(?!\s*(?:try|throw|if\s*\(!\w))[\s\S]*?await\s+/g, "Async function with awaits but no try/catch or null guard", "Wrap awaits in try/catch; surface errors to the caller or a logger", 0.3),
  rule("long-function", "maintainability", "medium", /^export\s+(?:async\s+)?function\s+\w+[\s\S]{1500,}?\n\}/gm, "Function body exceeds ~50 lines — likely doing too much", "Extract cohesive blocks into named helpers; aim for ≤30 lines per function", 0.3),
  rule("magic-numbers", "maintainability", "low", /if\s*\(\s*\w+\s*[><=]+\s*\d{2,}\s*\)/g, "Magic number in a conditional — should be a named constant", "Extract to a `const NAME = ...` at module top with a comment explaining the value", 0.25),
  rule("prompt-injection", "security", "medium", /\$\{[^}]*(?:req\.|input|user|prompt|article|content)\}/g, "Untrusted content interpolated directly into an LLM prompt", "Wrap user content in a clear delimiter and instruct the model to ignore instructions within the content", 0.6),

  rule("xss", "security", "critical", /dangerouslySetInnerHTML/g, "dangerouslySetInnerHTML used — unsanitized content enables XSS", "Use a sanitizer like DOMPurify, or prefer React's built-in JSX rendering which auto-escapes", 0.85),
  rule("resource-leak", "quality", "high", /\bsetInterval\s*\(/g, "setInterval used without clearInterval — memory leak if component unmounts", "Store the interval ID and call clearInterval() in a cleanup function", 0.7),
  rule("no-error-handling", "quality", "high", /\bawait\s+(?!.*\btry\b)/g, "await used without try/catch — unhandled rejection will crash the process", "Wrap awaits in try/catch, log the error, and handle failures gracefully", 0.6),
] as const satisfies readonly HeuristicRule[];

export function heuristicScan(code: string): Finding[] {
  const lineStarts = buildLineStarts(code);
  const dedup = new Map<string, Finding>();

  for (const currentRule of RULES) {
    for (const match of execAllMatches(code, currentRule.pattern)) {
      const finding: Finding = {
        category: currentRule.category,
        severity: currentRule.severity,
        line: lineNumberAtOffset(lineStarts, match.index),
        type: currentRule.type,
        description: currentRule.description,
        recommendation: currentRule.recommendation,
        confidence: currentRule.confidence,
      };

      if (finding.type === "no-error-handling" && isInsideTryBlock(code, finding.line)) {
        continue;
      }

      const key = `${finding.type}@${finding.line}`;
      const existing = dedup.get(key);
      if (!existing || finding.confidence > existing.confidence) {
        dedup.set(key, finding);
      }
    }
  }

  return [...dedup.values()].sort(
    (a, b) =>
      a.line - b.line ||
      a.severity.localeCompare(b.severity) ||
      a.type.localeCompare(b.type),
  );
}

function execAllMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const regex = cloneRegex(pattern);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }

  return matches;
}

function cloneRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineNumberAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }

  return high + 1;
}

function isInsideTryBlock(code: string, targetLine: number): boolean {
  const lines = code.split("\n");
  let braceDepth = 0;
  const tryDepths: number[] = [];

  for (let i = 0; i < targetLine - 1 && i < lines.length; i++) {
    const line = stripQuotedContent(lines[i]);

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === "{") {
        const prefix = line.slice(0, j).trimEnd();
        if (/\btry$/.test(prefix)) tryDepths.push(braceDepth);
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        while (tryDepths.length > 0 && tryDepths[tryDepths.length - 1] >= braceDepth) {
          tryDepths.pop();
        }
      }
    }
  }

  return tryDepths.length > 0;
}

function stripQuotedContent(line: string): string {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}
