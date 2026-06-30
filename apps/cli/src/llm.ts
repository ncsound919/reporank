// LLM client for RepoRank CLI — calls VibeServe's /v1/llm/complete endpoint.
// Per AGENTS.md: no hardcoded URLs (read from env), no eval(), proper error handling,
// no debug console.log in production.

import { setTimeout as sleep } from "node:timers/promises";
import { LLMCache } from "./llm-cache";

const VIBESERVE_URL = process.env.VIBESERVE_URL || "http://127.0.0.1:8000";
const VIBESERVE_API_KEY = process.env.VIBESERVE_API_KEY || "";
const LLM_TIMEOUT_MS = Number(process.env.REPORANK_LLM_TIMEOUT_MS || "30000");
const LLM_MAX_RETRIES = Number(process.env.REPORANK_LLM_RETRIES || "2");

// Set REPORANK_NO_LLM_CACHE=1 to disable caching (force fresh LLM calls).
// Set REPORANK_WIPE_LLM_CACHE=1 to delete the cache file at startup.
const CACHE_DISABLED = process.env.REPORANK_NO_LLM_CACHE === "1";
const CACHE = CACHE_DISABLED ? null : new LLMCache();
if (process.env.REPORANK_WIPE_LLM_CACHE === "1" && CACHE) {
  CACHE.reset();
  console.error("[llm-cache] wiped cache at startup");
}

export interface LLMCompleteOptions {
  prompt: string;
  temperature?: number;
  responseFormat?: "json" | "text";
  provider?: string;
  model?: string;
}

export interface LLMCompleteResult {
  content: string;
  provider: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latencyMs: number;
}

/** A token emitted by `llmStream`.  Each event is a delta — append to the
 *  previously-seen tokens to reconstruct the full response. */
export interface LLMStreamEvent {
  /** Incremental content chunk.  Empty string means "end of stream". */
  delta: string;
  /** Cumulative content (delta + everything before it).  Available on the
   *  final event only. */
  content?: string;
  /** Provider name. */
  provider?: string;
  /** Model name. */
  model?: string;
  /** Usage — available on the final event. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** True when the stream is complete. */
  done: boolean;
}

export interface LLMError {
  status: "error";
  error: string;
  provider?: string;
}

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

/**
 * Call VibeServe's /v1/llm/complete endpoint.
 *
 * Throws LLMUnavailableError if the service is unreachable or returns no content.
 * Callers should catch and fall back to heuristic-only analysis.
 */
export async function llmComplete(opts: LLMCompleteOptions): Promise<LLMCompleteResult> {
  // Cache lookup — skip the network roundtrip if we already have this response.
  // The cache key is (prompt, model, temperature, response_format) so identical
  // requests are served from disk.  Disable with REPORANK_NO_LLM_CACHE=1.
  //
  // The model name is read from the env (e.g. OLLAMA_MODEL) so the cache key
  // is stable across runs.  When unset we use "default" — same string is
  // used for both put and get.
  if (CACHE) {
    const cacheModel = process.env.OLLAMA_MODEL || process.env.GOOGLE_MODEL || opts.model || "default";
    const cached = CACHE.get(
      opts.prompt,
      cacheModel,
      opts.temperature ?? 0.3,
      opts.responseFormat ?? "text",
    );
    if (cached) {
      return {
        content: cached.content,
        provider: cached.provider,
        model: cached.model,
        usage: cached.usage,
        latencyMs: cached.latencyMs,
      };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let lastError: string = "unknown error";
  try {
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${VIBESERVE_URL}/v1/llm/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(VIBESERVE_API_KEY ? { "X-VibeServe-API-Key": VIBESERVE_API_KEY } : {}),
          },
          body: JSON.stringify({
            prompt: opts.prompt,
            temperature: opts.temperature ?? 0.3,
            response_format: opts.responseFormat ?? "text",
            ...(opts.provider ? { provider: opts.provider } : {}),
            ...(opts.model ? { model: opts.model } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // 4xx/5xx — try to parse JSON error, fall back to text
          const text = await res.text();
          let parsed: any = null;
          try { parsed = JSON.parse(text); } catch { /* not JSON */ }
          lastError = parsed?.error || `HTTP ${res.status}: ${text.slice(0, 200)}`;
          if (res.status >= 500 && attempt < LLM_MAX_RETRIES) {
            await sleep(250 * Math.pow(2, attempt));
            continue;
          }
          throw new LLMUnavailableError(lastError);
        }

        const body = (await res.json()) as any;
        if (body?.status !== "success" || !body?.content) {
          throw new LLMUnavailableError(body?.error || "empty response");
        }

        // Store in cache for future runs (skip if cache disabled)
        if (CACHE) {
          const cacheModel = process.env.OLLAMA_MODEL || process.env.GOOGLE_MODEL || opts.model || "default";
          CACHE.put(
            opts.prompt,
            cacheModel,
            opts.temperature ?? 0.3,
            opts.responseFormat ?? "text",
            body.content as string,
            body.provider as string,
            (body.usage as LLMCompleteResult["usage"]) || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            (body.latency_ms as number) || 0,
          );
        }

        return {
          content: body.content as string,
          provider: body.provider as string,
          model: body.model as string,
          usage: body.usage as LLMCompleteResult["usage"],
          latencyMs: body.latency_ms as number,
        };
      } catch (err) {
        if (err instanceof LLMUnavailableError) throw err;
        const e = err as Error;
        lastError = e.name === "AbortError" ? `timeout after ${LLM_TIMEOUT_MS}ms` : e.message;
        if (attempt < LLM_MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          continue;
        }
      }
    }
    throw new LLMUnavailableError(`LLM unreachable: ${lastError}`);
  } finally {
    // Always clear the timer to prevent the process from hanging on
    // a pending timeout. Without this, the timer keeps the event loop
    // alive for up to LLM_TIMEOUT_MS after the function returns.
    clearTimeout(timer);
  }
}

/**
 * Phase 3.1 — streaming LLM client. Calls VibeServe's `/v1/llm/stream` SSE
 * endpoint and yields each token as an `LLMStreamEvent`.
 *
 * Usage:
 * ```ts
 * for await (const event of llmStream({ prompt })) {
 *   if (event.done) {
 *     process.stdout.write("Total:", event.usage);
 *   } else {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * ```
 *
 * Falls back to a single non-streaming call if the streaming endpoint is
 * unavailable (404, 5xx, or unsupported provider).
 */
export async function* llmStream(opts: LLMCompleteOptions): AsyncGenerator<LLMStreamEvent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  // Helper: clear timer exactly once on the first fallback
  let timerCleared = false;
  const clearTimer = (): void => {
    if (!timerCleared) {
      clearTimeout(timer);
      timerCleared = true;
    }
  };

  // Helper: yield a single full-result event and return — used for fallbacks
  async function* yieldFull(): AsyncGenerator<LLMStreamEvent> {
    const full = await llmComplete(opts);
    yield { delta: full.content, content: full.content, provider: full.provider, model: full.model, usage: full.usage, done: true };
  }

  let res: Response;
  try {
    res = await fetch(`${VIBESERVE_URL}/v1/llm/stream`, {
      method: "GET",
      headers: {
        "Accept": "text/event-stream",
        ...(VIBESERVE_API_KEY ? { "X-VibeServe-API-Key": VIBESERVE_API_KEY } : {}),
        // Pass prompt via custom header since the bridge uses GET
        "X-Query-String": new URLSearchParams({
          prompt: opts.prompt,
          temperature: String(opts.temperature ?? 0.3),
          response_format: opts.responseFormat ?? "text",
          ...(opts.provider ? { provider: opts.provider } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        }).toString(),
      },
      signal: controller.signal,
    });
  } catch {
    // Network error — fall back to non-streaming
    clearTimer();
    for await (const ev of yieldFull()) yield ev;
    return;
  }
  clearTimer();

  if (!res.ok) {
    // Streaming endpoint not available — fall back to non-streaming
    for await (const ev of yieldFull()) yield ev;
    return;
  }
  if (!res.body) {
    for await (const ev of yieldFull()) yield ev;
    return;
  }

  // Parse SSE: each event is "data: <json>\n\n"
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cumulative = "";
  let finalUsage: LLMCompleteResult["usage"] | undefined;
  let finalProvider: string | undefined;
  let finalModel: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by \n\n)
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        // Strip "data: " prefix (and "event:" if present)
        const lines = raw.split("\n");
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              yield { delta: "", content: cumulative, provider: finalProvider, model: finalModel, usage: finalUsage, done: true };
              return;
            }
            try {
              const parsed = JSON.parse(data);
              // Ollama format: { message: { content: "..." }, done: bool }
              const delta = parsed.message?.content || parsed.content || parsed.delta || "";
              cumulative += delta;
              if (parsed.provider) finalProvider = parsed.provider;
              if (parsed.model) finalModel = parsed.model;
              if (parsed.usage || parsed.done) finalUsage = parsed.usage || finalUsage;
              if (delta) yield { delta, done: !!parsed.done };
            } catch {
              // Non-JSON event — treat as raw delta
              if (data) {
                cumulative += data;
                yield { delta: data, done: false };
              }
            }
          }
        }
      }
    }
    // Stream ended without [DONE]
    yield { delta: "", content: cumulative, provider: finalProvider, model: finalModel, usage: finalUsage, done: true };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released if reader was cancelled
    }
    clearTimer();
  }
}

/**
 * Build a JSON-only LLM prompt for codebase analysis.
 * Strips the content to avoid blowing context — keep it lean.
 */
export interface LLMAuditFinding {
  category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  file: string;
  description: string;
  recommendation: string;
}

export interface LLMAuditResult {
  summary: string;
  findings: LLMAuditFinding[];
  confidence: number; // 0..1
}

/**
 * Run an LLM-augmented audit on a slice of source files.
 * Returns null if the LLM is unavailable.
 */
export async function llmAudit(
  files: { path: string; content: string }[],
  rulesContext: string,
): Promise<LLMAuditResult | null> {
  if (files.length === 0) return null;

  // Trim each file to keep prompt under ~30K tokens
  const maxCharsPerFile = 6000;
  const trimmedFiles = files.slice(0, 8).map((f) => ({
    path: f.path,
    excerpt: f.content.slice(0, maxCharsPerFile),
  }));

  const userPrompt = `You are a senior code reviewer. Analyze these source files and return STRICT JSON only (no prose, no markdown).

Required JSON shape:
{
  "summary": "one-paragraph overview of code quality",
  "findings": [
    {
      "category": "security|quality|performance|maintainability|testing",
      "severity": "info|low|medium|high|critical",
      "file": "path/to/file",
      "description": "short description",
      "recommendation": "actionable fix"
    }
  ],
  "confidence": 0.0
}

Repo's project rules context:
${rulesContext.slice(0, 1500)}

Files to review:
${trimmedFiles.map((f) => `\n--- ${f.path} ---\n${f.excerpt}`).join("\n")}

Return strict JSON only.`;

  try {
    const result = await llmComplete({
      prompt: userPrompt,
      temperature: 0.2,
      responseFormat: "json",
    });

    let parsed: any;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      // Try to extract JSON from a code fence
      const m = result.content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("LLM returned non-JSON");
      parsed = JSON.parse(m[0]);
    }

    return {
      summary: String(parsed.summary || ""),
      findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 50) : [],
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
  } catch (err) {
    // Caller decides how to handle — return null to signal "no LLM signal"
    return null;
  }
}
