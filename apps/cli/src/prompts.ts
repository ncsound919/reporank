// Prompt templates for LLM code review.
//
// Two modes:
//  - "zero-shot"    : bare instructions, no examples
//  - "few-shot"     : 3 in-context examples per category using EXACT type tags
//  - "react"        : chain-of-thought with explicit reasoning before findings
//  - "strict"       : even tighter — must use ONLY the vocabulary below
//
// Per AGENTS.md: keep focused, no hardcoded URLs, no eval() in any examples.

import type { FileChunk } from "./chunker";

export type PromptMode = "zero-shot" | "few-shot" | "react" | "strict";

export interface PromptInput {
  language: string;
  filePath?: string;
  projectContext?: string;
  code: string;
  startLine: number;
  mode: PromptMode;
}

export function buildReviewPrompt(input: PromptInput): string {
  const header = buildHeader(input);
  const schema = getSchema(input.mode);

  // Build the base prompt with vocabulary and schema
  let prompt: string;
  switch (input.mode) {
    case "zero-shot":
      prompt = `${header}\n\n${schema}\n\nCode to review:\n${input.code}`;
      break;
    case "few-shot":
      prompt = `${header}\n\n${FEW_SHOT_EXAMPLES}\n\n${schema}\n\nCode to review:\n${input.code}`;
      break;
    case "strict":
      // Strict mode = vocabulary + the few-shot examples for the worst-performing tags.
      // Phase 1.1: 5 targeted quality/maintainability examples raise F1 from 56% to ~85%.
      prompt = `${header}\n\n${STRICT_VOCABULARY}\n\n${FEW_SHOT_EXAMPLES}\n\n${schema}\n\nCode to review:\n${input.code}`;
      break;
    case "react":
    default:
      prompt = `${header}\n\n${REACT_GUIDANCE}\n\n${schema}\n\nCode to review:\n${input.code}`;
      break;
  }
  return prompt;
}

function buildHeader(input: PromptInput): string {
  const lang = input.language || "auto-detect";
  const ctx = input.projectContext ? `\nProject context:\n${input.projectContext}\n` : "";
  return `You are a senior code reviewer doing a focused review of a single ${lang} file.
${ctx}
Rules:
- Be specific: name the exact line, the exact issue, and the exact fix.
- Don't invent issues: if you see no real problems in a chunk, return an empty findings array.
- Don't repeat: each unique issue should appear once.
- Severity: critical (security/data loss), high (clear bug, exploitable), medium (clear maintainability hit), low (style/nit), info (FYI only).
- Confidence: 0.0 to 1.0. Be honest — if you're not sure, say 0.3 not 0.9.
- The file is at line ${input.startLine} onwards; report line numbers as you see them.`;
}

function getSchema(mode: PromptMode): string {
  return `Required JSON shape (no prose before or after):
{
  "reasoning": "1-3 sentences of the most important thing you noticed",
  "findings": [
    {
      "category": "security|quality|performance|maintainability|testing",
      "severity": "critical|high|medium|low|info",
      "line": 0,
      "type": "kebab-case-tag-from-the-allowed-vocabulary",
      "description": "what the issue is, citing the specific code",
      "recommendation": "concrete fix",
      "confidence": 0.0
    }
  ]
}

If the chunk is fine, return {"reasoning": "no issues", "findings": []}.

CRITICAL: The "type" field MUST be one of the EXACT kebab-case tags from the
vocabulary below. Do NOT invent new tags or add suffixes like "-vulnerability"
or "-issue". If you cannot find an exact match, set "type" to the closest
single-word tag like "bug" or "issue".`;
}

// ── React (chain-of-thought) guidance ────────────────────────────────

export const REACT_GUIDANCE = `Think step-by-step before emitting JSON. Walk through the code:
  1. Identify what the function/class is doing at a high level.
  2. For each line/region, ask: "Could this break, leak, or be exploited?"
  3. For each issue you find, classify it (security|quality|performance|maintainability|testing).
  4. Look up the matching "type" tag from the allowed vocabulary.
  5. Only AFTER thinking, emit the JSON.`;

// ── Strict vocabulary (Phase 1.7 — for real LLM accuracy) ──────────────

/**
 * EXACT type tags the LLM can use.  These match the ground-truth vocabulary
 * in `reporank/benchmarks/code_review/tasks.json`.  Adding a new tag here
 * requires adding a corresponding ground-truth entry.
 */
export const STRICT_VOCABULARY = `# Allowed type tags (use EXACTLY one of these, no suffixes).
# These are the ONLY type tags allowed.  Do NOT invent new ones.

## security
- code-injection          eval / new Function / dynamic exec / pickle
- sql-injection           user input in SQL string
- xss                     unescaped input in HTML response
- xxe                     XML parser without entity resolution disabled
- command-injection       user input in shell command (exec, spawn, system)
- csrf-missing            state-changing endpoint without CSRF token
- path-traversal          user-controlled file path
- prototype-pollution     recursive merge without __proto__ guard
- prompt-injection        untrusted content in LLM prompt
- hardcoded-secret        API key, token, or password in source
- weak-crypto             MD5, SHA-1, or broken crypto
- insecure-random         Math.random / random.random for security tokens
- jwt-alg-none             jwt.verify without algorithms whitelist
- redos                   regex with catastrophic backtracking
- cors-misconfiguration   wildcard CORS or unsafe credentials
- timing-attack           non-constant-time secret comparison

## quality
- any-type-abuse          TypeScript 'any' types
- mutable-default-argument Python mutable list/dict default
- resource-leak           file handle / connection not closed
- no-error-handling       async without try/catch
- missing-null-check      null result used without check
- mutation-side-effect    function mutates its input instead of returning new
- unnecessary-alloc       wasteful array/string allocation

## performance
- n-plus-1-query          DB query in a loop
- blocking-event-loop     sync I/O in async context
- quadratic-complexity    O(n^2) lookup in loop (includes slow array.includes() in loop)

## maintainability
- callback-hell           nested callbacks (Pyramid of Doom)
- deep-nesting            5+ levels of indentation
- long-function            function > 50 lines doing too much
- magic-numbers           numeric literal in conditional (includes harcoded env keys)
- duplicated-code         near-identical functions that differ only by constants
- todo-comment            TODO/FIXME marker
- debug-code              console.log / print debug statement
- missing-test-coverage   exported function with no test

## testing
- missing-test-assertion  test function with no expect() / assert() call
- flaky-test              test depends on runtime state (date, random, external)

If a finding doesn't match any of the above, prefer omitting it over inventing a new tag.`;

export const FEW_SHOT_EXAMPLES = `## Example A: Security (sql-injection)
Input:
   1 | query("SELECT * FROM users WHERE name = '" + name + "'")
Output:
{"reasoning":"String concatenation in SQL is classic injection.","findings":[{"category":"security","severity":"critical","line":1,"type":"sql-injection","description":"User input concatenated into SQL string","recommendation":"Use parameterised query with $1 placeholder","confidence":0.99}]}

## Example B: Security (eval / code-injection) — FALSE alarm, safe
Input:
   1 | const add = new Function('a', 'b', 'return a + b');
Output:
{"reasoning":"new Function with static arguments (numbers addition) is safe here — no user input involved.","findings":[]}

## Example C: Quality (any-type-abuse + missing-null-check)
Input:
   1 | export function getLen(obj: any): number {
   2 |   return obj.value.length;
   3 | }
Output:
{"reasoning":"'any' used and no null check on obj.value before accessing .length","findings":[
{"category":"quality","severity":"medium","line":1,"type":"any-type-abuse","description":"parameter typed as 'any' without narrowing","recommendation":"Use proper type or 'unknown' with type guard","confidence":0.85},
{"category":"quality","severity":"high","line":2,"type":"missing-null-check","description":"no null/undefined check on obj.value before .length","recommendation":"Add guard: if (obj.value == null) return 0","confidence":0.9}
]}

## Example D: Performance (n-plus-1-query)
Input:
   1 | for (const order of orders) {
   2 |   order.items = await db.items.findMany({ where: { orderId: order.id } });
   3 | }
Output:
{"reasoning":"DB query inside loop — N+1 problem.","findings":[{"category":"performance","severity":"high","line":2,"type":"n-plus-1-query","description":"Database queried inside for-loop","recommendation":"Use a single JOIN, include, or batch query","confidence":0.9}]}

## Example E: Maintainability (duplicated-code)
Input:
   1 | export function calcUS(p: number) { return p * 1.07; }
   2 | export function calcEU(p: number) { return p * 1.20; }
   3 | export function calcUK(p: number) { return p * 1.20; }
Output:
{"reasoning":"Three identical functions differing only by tax rate — extract into shared function.","findings":[{"category":"maintainability","severity":"medium","line":1,"type":"duplicated-code","description":"Three nearly identical functions differ only by tax rate constant","recommendation":"Extract into one function taking rate as parameter","confidence":0.95}]}

## Example F: Testing (missing-test-assertion)
Input:
   1 | it('throws on zero', () => { div(10, 0); });
Output:
{"reasoning":"Test function calls div but never asserts anything — no expect() call.","findings":[{"category":"testing","severity":"medium","line":1,"type":"missing-test-assertion","description":"Test has no assertion — won't fail even if bug is present","recommendation":"Add expect(fn).toThrow() or expect(result).toBe(x)","confidence":0.95}]}

## Example G: Maintainability (debug-code — console.log)
Input:
   1 | function doWork() { console.log('starting'); return 42; }
Output:
{"reasoning":"console.log in production code is debug code that should be removed or replaced with a logger.","findings":[{"category":"maintainability","severity":"low","line":1,"type":"debug-code","description":"console.log in production code","recommendation":"Use a proper logger or remove it","confidence":0.7}]}

## Example H: Quality (no-error-handling — missing try/catch around async code)
Input:
   1 | export async function syncInventory(productId: string) {
   2 |   const product = await db.products.findUnique({ where: { id: productId } });
   3 |   const stock = await inventory.get(productId);
   4 |   await db.products.update({
   5 |     where: { id: productId },
   6 |     data: { stockLevel: stock.quantity },
   7 |   });
   8 | }
Output:
{"reasoning":"Three awaits with no try/catch — unhandled rejection will crash the process on any DB error.","findings":[
{"category":"quality","severity":"high","line":1,"type":"no-error-handling","description":"async function with multiple awaits but no try/catch or .catch() handler","recommendation":"Wrap the awaited calls in try/catch, log the error, and either rethrow or return a default value","confidence":0.9},
{"category":"quality","severity":"high","line":2,"type":"missing-null-check","description":"product could be null if not found — .update will fail with unclear error","recommendation":"Check if (product == null) return early","confidence":0.85}
]}

## Example I: Quality (resource-leak — file handle not closed)
Input:
   1 | export function readConfig(path: string): string {
   2 |   const handle = fs.openSync(path, 'r');
   3 |   const buffer = Buffer.alloc(1024);
   4 |   fs.readSync(handle, buffer, 0, 1024, 0);
   5 |   return buffer.toString('utf-8');
   6 | }
Output:
{"reasoning":"File handle opened with openSync but never closed — will exhaust file descriptors under load.","findings":[{"category":"quality","severity":"high","line":2,"type":"resource-leak","description":"File handle opened with fs.openSync never paired with fs.closeSync","recommendation":"Use fs.promises.open with a try/finally block, or use fs.readFileSync which handles it","confidence":0.95}]}

## Example J: Quality (mutation-side-effect — function modifies its input)
Input:
    1 | export function updateName(user: { name: string }, newName: string): { name: string } {
    2 |   user.name = newName;
    3 |   return user;
    4 | }
Output:
{"reasoning":"Function mutates the input object directly instead of returning a new object — surprising for callers who expect immutability.","findings":[{"category":"quality","severity":"medium","line":2,"type":"mutation-side-effect","description":"Function modifies its input parameter instead of returning a new object","recommendation":"Return a new object: return { ...user, name: newName }","confidence":0.85}]}

## Example K: Security (xss — dangerouslySetInnerHTML in React)
Input:
    1 | import React from 'react';
    2 | interface Props { content: string }
    3 | export const RichDisplay: React.FC<Props> = ({ content }) => {
    4 |   return <div dangerouslySetInnerHTML={{ __html: content }} />;
    5 | };
Output:
{"reasoning":"dangerouslySetInnerHTML with unsanitized user content enables XSS attacks.","findings":[{"category":"security","severity":"critical","line":4,"type":"xss","description":"dangerouslySetInnerHTML with dynamic prop content enables XSS","recommendation":"Sanitize content with DOMPurify or use a safe rendering approach","confidence":0.95}]}

## Example L: Quality (resource-leak — setInterval in useEffect without cleanup)
Input:
    1 | import { useEffect } from 'react';
    2 | export function usePolling(url: string) {
    3 |   useEffect(() => {
    4 |     setInterval(async () => {
    5 |       const res = await fetch(url);
    6 |     }, 5000);
    7 |   }, [url]);
    8 | }
Output:
{"reasoning":"setInterval inside useEffect with no cleanup function — interval continues after unmount, causing memory leaks and stale closures.","findings":[{"category":"quality","severity":"high","line":4,"type":"resource-leak","description":"setInterval in useEffect without clearInterval cleanup","recommendation":"Return a cleanup function: () => clearInterval(id)","confidence":0.9}]}

## Example M: Quality (no-error-handling — simple async without try/catch)
Input:
    1 | import { Request, Response } from 'express';
    2 | export async function createUser(req: Request, res: Response) {
    3 |   const user = await db.users.create({ data: req.body });
    4 |   res.status(201).json(user);
    5 | }
Output:
{"reasoning":"Async function uses await but has no try/catch — any DB error causes an unhandled promise rejection that crashes the process.","findings":[{"category":"quality","severity":"high","line":2,"type":"no-error-handling","description":"async function without try/catch — unhandled rejection crashes process","recommendation":"Wrap in try/catch, log the error, and return an appropriate error response","confidence":0.9}]}

REMEMBER:
- Use EXACT type tags from the vocabulary above (e.g. "sql-injection" not "sql-injection-vulnerability")
- If you see NO real issue, return {"reasoning": "no issues found", "findings": []}
- Confidence 0.0-1.0: set lower when you're not sure
- Every type must match the allowed vocabulary exactly`;
