// Heuristic (regex-based) code review scanner.
//
// Pure pattern matching, no LLM required. This is the "baseline" against which
// we measure the value of LLM augmentation. Findings are tagged with stable
// `type` strings so the harness can score them against the same ground truth.
//
// Per AGENTS.md: no hardcoded URLs, no eval(), files under 300 lines.

import type { Finding } from "./review_scanner";

interface HeuristicRule {
  type: string;
  category: Finding["category"];
  severity: Finding["severity"];
  /** Regex must be safe (no backtracking traps, no \b-on-unicode pitfalls) */
  pattern: RegExp;
  description: string;
  recommendation: string;
  /** Min confidence for this rule (0..1) */
  confidence: number;
}

const RULES: HeuristicRule[] = [
  // ── Security ──────────────────────────────────────────────
  {
    type: "code-injection",
    category: "security",
    severity: "critical",
    pattern: /\bnew\s+Function\s*\(/g,
    description: "new Function() compiles and executes arbitrary code from a string",
    recommendation: "Use a static function or a sandboxed VM (vm2/isolated-vm) with strict input validation",
    confidence: 0.95,
  },
  {
    type: "code-injection",
    category: "security",
    severity: "critical",
    pattern: /\beval\s*\(/g,
    description: "eval() executes arbitrary code from a string",
    recommendation: "Replace with a safe parser; if dynamic evaluation is required, use a sandboxed VM",
    confidence: 0.99,
  },
  {
    type: "sql-injection",
    category: "security",
    severity: "critical",
    pattern: /(?:query|execute|exec)\s*\(\s*[`"'][^`"']*\$\{[^}]+\}[^`"']*[`"']/g,
    description: "User input interpolated into a SQL string (template literal in query/exec)",
    recommendation: "Use a parameterised query with placeholders ($1, ?, :name) and a values array",
    confidence: 0.9,
  },
  {
    type: "sql-injection",
    category: "security",
    severity: "critical",
    pattern: /(?:query|execute|exec)\s*\(\s*["'][^"']*["']\s*\+\s*[A-Za-z_]/g,
    description: "String concatenation with user input passed to query/exec",
    recommendation: "Use a parameterised query instead of string concatenation",
    confidence: 0.85,
  },
  {
    type: "xss",
    category: "security",
    severity: "high",
    pattern: /res\.send\s*\(\s*[`"'][^`"']*\$\{[^}]*(?:req\.|input|user|comment)/g,
    description: "Unsanitized user input rendered directly in HTTP response",
    recommendation: "Use a templating engine with auto-escaping (e.g. EJS, Handlebars) or sanitise with DOMPurify",
    confidence: 0.85,
  },
  {
    type: "path-traversal",
    category: "security",
    severity: "high",
    pattern: /(?:readFile|createReadStream)\s*\(\s*(?:path\.(?:join|resolve))?\s*\([^)]*req\.|.*\+.*req\./g,
    description: "File path constructed from user input without validation",
    recommendation: "Validate the resolved path stays inside the intended root using path.resolve + startsWith check",
    confidence: 0.75,
  },
  {
    type: "weak-crypto",
    category: "security",
    severity: "medium",
    pattern: /\b(?:hashlib\.md5|createHash\s*\(\s*["']md5["']\s*\)|CryptoJS\.MD5)/g,
    description: "MD5 is cryptographically broken",
    recommendation: "Use SHA-256 for non-password hashing; use bcrypt/argon2/scrypt for password hashing",
    confidence: 0.95,
  },
  {
    type: "weak-crypto",
    category: "security",
    severity: "medium",
    pattern: /\b(?:hashlib\.sha1|createHash\s*\(\s*["']sha1["']\s*\))/g,
    description: "SHA-1 is deprecated for security use",
    recommendation: "Use SHA-256 or SHA-3",
    confidence: 0.9,
  },
  {
    type: "insecure-random",
    category: "security",
    severity: "medium",
    pattern: /\b(?:Math\.random|random\.random|random\.randint)\s*\(\s*\).*(?:token|secret|session|nonce|key)/gi,
    description: "Math.random/random is not cryptographically secure for token generation",
    recommendation: "Use crypto.randomBytes() (Node), secrets module (Python), or crypto.SecureRandom (Java)",
    confidence: 0.7,
  },
  {
    type: "jwt-alg-none",
    category: "security",
    severity: "critical",
    pattern: /jwt\.verify\s*\([^)]*,\s*['"][^'"]+['"]\s*\)/g,
    description: "jwt.verify without algorithms option allows the alg=none attack",
    recommendation: "Pass { algorithms: ['HS256'] } (or your expected algorithm) as the third argument",
    confidence: 0.85,
  },
  {
    type: "redos",
    category: "security",
    severity: "high",
    pattern: /\(\?:\?\.\*\?\)[\+\*]/g,
    description: "Nested quantifier pattern (e.g. (a+)+, (.*)*) can cause catastrophic backtracking",
    recommendation: "Refactor the regex to avoid nested quantifiers; benchmark with a ReDoS tool",
    confidence: 0.6,
  },
  {
    type: "hardcoded-secret",
    category: "security",
    severity: "high",
    pattern: /(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|sk_live_[0-9A-Za-z]{24,}|AKIA[0-9A-Z]{16})/g,
    description: "Hardcoded API key or credential detected in source",
    recommendation: "Move secrets to environment variables; rotate the exposed credential immediately",
    confidence: 0.98,
  },
  {
    type: "hardcoded-secret",
    category: "security",
    severity: "high",
    pattern: /(?:postgresql|mysql|mongodb|redis):\/\/[^\s'"]+:[^\s'"]+@/g,
    description: "Database connection string with embedded password",
    recommendation: "Move credentials to env vars; use a secrets manager (Vault, AWS Secrets Manager)",
    confidence: 0.9,
  },
  {
    type: "cors-misconfiguration",
    category: "security",
    severity: "high",
    pattern: /cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/g,
    description: "CORS configured with wildcard origin",
    recommendation: "Whitelist specific allowed origins; never use '*' with credentials:true",
    confidence: 0.95,
  },
  {
    type: "prototype-pollution",
    category: "security",
    severity: "high",
    pattern: /for\s*\(\s*(?:const|let|var)\s+\w+\s+(?:of|in)\s+Object\.keys/g,
    description: "Recursive merge over Object.keys may allow prototype pollution",
    recommendation: "Guard against __proto__, constructor, prototype keys; use Object.create(null) or structuredClone",
    confidence: 0.5,
  },
  {
    type: "timing-attack",
    category: "security",
    severity: "medium",
    pattern: /return\s+\w+\s*===\s*\w+\s*;.*(?:token|secret|password|key)/gis,
    description: "Plain string comparison of secret values — vulnerable to timing attacks",
    recommendation: "Use crypto.timingSafeEqual (Node) or hmac.compare_digest (Python)",
    confidence: 0.6,
  },

  // ── Quality / Maintainability ─────────────────────────────
  {
    type: "any-type-abuse",
    category: "quality",
    severity: "medium",
    pattern: /:\s*any\b/g,
    description: "Use of `any` defeats TypeScript type safety",
    recommendation: "Replace with proper types, generics, or `unknown` for values that need narrowing",
    confidence: 0.85,
  },
  {
    type: "debug-code",
    category: "quality",
    severity: "low",
    pattern: /console\.(log|debug)\s*\(/g,
    description: "console.log/debug statements should be removed from production code",
    recommendation: "Use a proper logger (pino, winston, structlog) with appropriate log levels",
    confidence: 0.5,  // Low because console.log can be legitimate
  },
  {
    type: "todo-comment",
    category: "maintainability",
    severity: "low",
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX)\b/gi,
    description: "TODO/FIXME marker indicates incomplete work or a known issue",
    recommendation: "Track in your issue tracker and link from the comment, or implement the fix",
    confidence: 0.95,
  },
  {
    type: "fixme-known-bug",
    category: "maintainability",
    severity: "medium",
    pattern: /\/\/\s*FIXME\b/gi,
    description: "FIXME comment indicates a known bug",
    recommendation: "File an issue and link from the comment; prioritise the fix",
    confidence: 0.9,
  },
  {
    type: "missing-test-coverage",
    category: "maintainability",
    severity: "low",
    pattern: /^export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*[:{][^}]*\}[^}]*$/gm,
    description: "Exported function with no obvious test file reference",
    recommendation: "Add a test file (e.g. foo.test.ts) covering the happy path and key edge cases",
    confidence: 0.2,  // Hard to detect heuristically — relies on harness noticing no test files
  },

  // ── Performance ──────────────────────────────────────────
  {
    type: "n-plus-1-query",
    category: "performance",
    severity: "high",
    pattern: /for\s*\([^)]+\)\s*\{[^}]*await\s+(?:db|prisma|sequelize|knex|query)\./gs,
    description: "Database query inside a for-loop — likely N+1",
    recommendation: "Use a single query with IN clause, JOIN, or include() to fetch all rows at once",
    confidence: 0.7,
  },
  {
    type: "blocking-event-loop",
    category: "performance",
    severity: "high",
    pattern: /(?:readFileSync|writeFileSync|execSync|spawnSync)\s*\(/g,
    description: "Synchronous I/O blocks the event loop in async contexts",
    recommendation: "Use the async variant (readFile, writeFile, exec) in request handlers",
    confidence: 0.6,
  },
  {
    type: "quadratic-complexity",
    category: "performance",
    severity: "medium",
    pattern: /if\s+\w+\s+in\s+\w+\s*[\[\.]/g,
    description: "Lookup in an array inside a loop — O(n²) pattern",
    recommendation: "Convert to a Set for O(1) lookups, or restructure the algorithm",
    confidence: 0.5,
  },

  // ── Style / safety ────────────────────────────────────────
  {
    type: "mutable-default-argument",
    category: "quality",
    severity: "high",
    pattern: /def\s+\w+\s*\([^)]*=\s*\[\s*\]\s*\)/g,
    description: "Mutable list as default argument (Python gotcha — shared across calls)",
    recommendation: "Use def f(x=None): x = x or []  or  x = list(x) if x else []",
    confidence: 0.95,
  },
  {
    type: "resource-leak",
    category: "quality",
    severity: "high",
    pattern: /fs\.openSync\s*\(/g,
    description: "File handle opened with fs.openSync — must be paired with fs.closeSync",
    recommendation: "Use fs.promises.open() with try/finally, or wrap in a context manager",
    confidence: 0.7,
  },
  {
    type: "race-condition",
    category: "quality",
    severity: "high",
    pattern: /let\s+\w+\s*=\s*0[\s\S]{0,200}const\s+\w+\s*=\s*\w+[\s\S]{0,200}await[\s\S]{0,200}=.*\+.*1/gs,
    description: "Read-modify-write on shared state with await in the middle — race condition",
    recommendation: "Use atomic operations, a mutex, or move the increment into a single non-interleaved expression",
    confidence: 0.45,
  },
  {
    type: "async-foreach-bug",
    category: "quality",
    severity: "medium",
    pattern: /\.forEach\s*\(\s*async\s*\(/g,
    description: "forEach with async callback — promises are not awaited",
    recommendation: "Use for...of with await, or Promise.all(items.map(asyncFn))",
    confidence: 0.95,
  },
  {
    type: "callback-hell",
    category: "maintainability",
    severity: "medium",
    pattern: /function\s*\([^)]*\)\s*\{[^}]*function\s*\([^)]*\)\s*\{[^}]*function\s*\(/gs,
    description: "Triple-nested callbacks (Pyramid of Doom)",
    recommendation: "Refactor to async/await or Promises; extract helpers to flatten the call graph",
    confidence: 0.6,
  },
  {
    type: "deep-nesting",
    category: "maintainability",
    severity: "low",
    pattern: /^(\s*)(\s*\2){5,}\S/gm,
    description: "Six or more levels of indentation — readability hit",
    recommendation: "Use early returns (guard clauses) or extract nested logic into named functions",
    confidence: 0.5,
  },
  {
    type: "missing-null-check",
    category: "quality",
    severity: "medium",
    pattern: /await\s+\w+\.find(?:Unique|First|One)\s*\([^)]*\)\s*;[\s\S]{0,300}\.\w+\.\w+\(/g,
    description: "Result of findUnique/findFirst used without null check",
    recommendation: "Guard with `if (!result) return ...` or use optional chaining with explicit handling",
    confidence: 0.4,
  },
  {
    type: "no-error-handling",
    category: "quality",
    severity: "medium",
    pattern: /export\s+async\s+function\s+\w+\s*\([^)]*\)\s*:\s*Promise<[^>]+>\s*\{(?!\s*(?:try|throw|if\s*\(!\w))[\s\S]*?await\s+/g,
    description: "Async function with awaits but no try/catch or null guard",
    recommendation: "Wrap awaits in try/catch; surface errors to the caller or a logger",
    confidence: 0.3,
  },
  {
    type: "long-function",
    category: "maintainability",
    severity: "medium",
    pattern: /^export\s+(?:async\s+)?function\s+\w+[\s\S]{1500,}?\n\}/gm,
    description: "Function body exceeds ~50 lines — likely doing too much",
    recommendation: "Extract cohesive blocks into named helpers; aim for ≤30 lines per function",
    confidence: 0.3,
  },
  {
    type: "magic-numbers",
    category: "maintainability",
    severity: "low",
    pattern: /if\s*\(\s*\w+\s*[><=]+\s*\d{2,}\s*\)/g,
    description: "Magic number in a conditional — should be a named constant",
    recommendation: "Extract to a `const NAME = ...` at module top with a comment explaining the value",
    confidence: 0.25,
  },
  {
    type: "prompt-injection",
    category: "security",
    severity: "medium",
    pattern: /\$\{[^}]*(?:req\.|input|user|prompt|article|content)\}/g,
    description: "Untrusted content interpolated directly into an LLM prompt",
    recommendation: "Wrap user content in a clear delimiter and instruct the model to ignore instructions within the content",
    confidence: 0.6,
  },
];

/**
 * Run all heuristic rules against the source code and return findings.
 * Lines are 1-based and refer to the first line of each match.
 */
export function heuristicScan(code: string): Finding[] {
  const findings: Finding[] = [];
  const lines = code.split("\n");

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(code)) !== null) {
      const line = lineNumberAtOffset(code, m.index);
      findings.push({
        category: rule.category,
        severity: rule.severity,
        line,
        type: rule.type,
        description: rule.description,
        recommendation: rule.recommendation,
        confidence: rule.confidence,
      });
      // Avoid infinite loops on zero-width matches
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
    }
  }

  // De-dupe: same type + same line → keep highest confidence
  const dedup = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.type}@${f.line}`;
    const existing = dedup.get(key);
    if (!existing || f.confidence > existing.confidence) {
      dedup.set(key, f);
    }
  }
  return [...dedup.values()];
}

function lineNumberAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
